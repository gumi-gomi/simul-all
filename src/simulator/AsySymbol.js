// src/simulator/AsySymbol.js
import React from "react";

/**
 * data 구조 예시 (parseASY 결과):
 * {
 *   lines: [{x1,y1,x2,y2}],
 *   rects: [{x,y,w,h, rx, ry}],
 *   circles: [{cx,cy,r}],
 *   arcs: [
 *     // 1) 중심+각 기반
 *     { cx, cy, r, startAngle, endAngle, clockwise?: boolean }
 *     // 2) SVG arc 파라미터 기반
 *     // { x1,y1,x2,y2, rx, ry, rotation, largeArcFlag, sweepFlag }
 *   ],
 *   texts: [{x,y,text,size,anchor,rotation}],
 *   pins: [{x,y,name,orientation}], // orientation: 'R','L','U','D' 등 (있을 때)
 *   bbox: { x, y, w, h },           // 없으면 아래에서 계산
 *   centerX, centerY                 // 없으면 bbox 기준 자동 계산
 * }
 */

function computeBBox(data) {
  // 가능한 모든 요소 좌표를 수집해 bbox 추정
  const xs = [];
  const ys = [];

  const pushPoint = (x, y) => {
    if (isFinite(x)) xs.push(x);
    if (isFinite(y)) ys.push(y);
  };

  (data.lines || []).forEach((l) => {
    pushPoint(l.x1, l.y1);
    pushPoint(l.x2, l.y2);
  });

  (data.rects || []).forEach((r) => {
    pushPoint(r.x, r.y);
    pushPoint(r.x + r.w, r.y + r.h);
  });

  (data.circles || []).forEach((c) => {
    pushPoint(c.cx - c.r, c.cy - c.r);
    pushPoint(c.cx + c.r, c.cy + c.r);
  });

  (data.arcs || []).forEach((a) => {
    if ("cx" in a && "cy" in a && "r" in a) {
      // 중심+반지름
      pushPoint(a.cx - a.r, a.cy - a.r);
      pushPoint(a.cx + a.r, a.cy + a.r);
    } else if ("x1" in a && "y1" in a && "x2" in a && "y2" in a) {
      // SVG arc 파라미터 기반: 근사
      pushPoint(a.x1, a.y1);
      pushPoint(a.x2, a.y2);
    }
  });

  (data.texts || []).forEach((t) => {
    pushPoint(t.x, t.y);
  });

  (data.pins || []).forEach((p) => {
    pushPoint(p.x, p.y);
  });

  if (!xs.length || !ys.length) {
    // 아무것도 없으면 기본 박스
    return { x: 0, y: 0, w: 40, h: 40 };
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** 중심/각 기반 원호 path 생성 */
function arcPathFromCenter({ cx, cy, r, startAngle, endAngle, clockwise = false }) {
  // 각도를 라디안으로 변환
  const a0 = toRad(startAngle);
  const a1 = toRad(endAngle);

  const x1 = cx + r * Math.cos(a0);
  const y1 = cy + r * Math.sin(a0);
  const x2 = cx + r * Math.cos(a1);
  const y2 = cy + r * Math.sin(a1);

  // SVG arc flags
  let delta = (endAngle - startAngle) % 360;
  if (delta < 0) delta += 360;

  // sweepFlag: 1 = 시계방향, 0 = 반시계 (SVG 정의는 y축 아래가 + 이라서 시각적 방향에 주의)
  const sweepFlag = clockwise ? 1 : 0;
  const largeArcFlag = delta > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${x2} ${y2}`;
}

/** SVG arc 파라미터 기반 path 생성 */
function arcPathFromSvgParams({ x1, y1, x2, y2, rx, ry, rotation = 0, largeArcFlag = 0, sweepFlag = 1 }) {
  // rx, ry 기본값 보정
  const R = Math.max(1, rx || ry || 1);
  const RX = rx ?? R;
  const RY = ry ?? R;

  return `M ${x1} ${y1} A ${RX} ${RY} ${rotation || 0} ${largeArcFlag ? 1 : 0} ${sweepFlag ? 1 : 0} ${x2} ${y2}`;
}

export default function AsySymbol({
  data,
  x = 0,
  y = 0,
  rot = 0,
  scale = 1,
  strokeWidth = 2,
  portRadius = 3,
  showPinNames = true,
  debugBBox = false,
}) {
  if (!data) return null;

  const bbox = data.bbox || computeBBox(data);
  const cxLocal = Number.isFinite(data.centerX) ? data.centerX : bbox.x + bbox.w / 2;
  const cyLocal = Number.isFinite(data.centerY) ? data.centerY : bbox.y + bbox.h / 2;

  // SVG transform은 오른쪽에서 왼쪽 순서로 적용됨.
  // (1) 원점 이동(-center) → (2) 회전 → (3) 다시 +center → (4) 스케일 → (5) 전체 위치 translate
  // translate(center) rotate rot translate(-center) 를 한 그룹으로 묶고, 그 바깥에서 translate(x,y)와 scale 적용
  const localRotation =
    `translate(${cxLocal},${cyLocal}) rotate(${rot}) translate(${-cxLocal},${-cyLocal})`;

  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      {/* 회전은 로컬 좌표계에서 center 기준 적용 */}
      <g transform={localRotation}>

        {/* 디버그용 Bounding Box */}
        {debugBBox && (
          <rect
            x={bbox.x}
            y={bbox.y}
            width={bbox.w}
            height={bbox.h}
            fill="none"
            stroke="rgba(255,0,0,0.6)"
            strokeDasharray="4 2"
          />
        )}

        {/* LINE */}
        {(data.lines || []).map((ln, idx) => (
          <line
            key={`ln-${idx}`}
            x1={ln.x1}
            y1={ln.y1}
            x2={ln.x2}
            y2={ln.y2}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* RECT */}
        {(data.rects || []).map((r, idx) => (
          <rect
            key={`rc-${idx}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={r.rx || 0}
            ry={r.ry || 0}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* CIRCLE */}
        {(data.circles || []).map((c, idx) => (
          <circle
            key={`c-${idx}`}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* ARC */}
        {(data.arcs || []).map((a, idx) => {
          let d = "";
          if ("cx" in a && "cy" in a && "r" in a && "startAngle" in a && "endAngle" in a) {
            d = arcPathFromCenter(a);
          } else if ("x1" in a && "y1" in a && "x2" in a && "y2" in a) {
            d = arcPathFromSvgParams(a);
          } else {
            return null;
          }
          return (
            <path
              key={`arc-${idx}`}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {/* TEXT */}
        {(data.texts || []).map((t, idx) => (
          <text
            key={`tx-${idx}`}
            x={t.x}
            y={t.y}
            fontSize={t.size || 12}
            textAnchor={t.anchor || "start"}
            dominantBaseline="middle"
            transform={t.rotation ? `rotate(${t.rotation}, ${t.x}, ${t.y})` : undefined}
            fill="currentColor"
            style={{ userSelect: "none" }}
          >
            {t.text}
          </text>
        ))}

        {/* PINS */}
        {(data.pins || []).map((p, idx) => {
          // 핀 표시 + 라벨 (방향에 따라 라벨 오프셋)
          const name = p.name || "";
          let dx = 0, dy = 0;
          const off = 10; // 라벨 오프셋
          switch ((p.orientation || "").toUpperCase()) {
            case "R": dx = off; dy = 0; break;
            case "L": dx = -off; dy = 0; break;
            case "U": dx = 0; dy = -off; break;
            case "D": dx = 0; dy = off; break;
            default: dx = off; dy = -off; break;
          }

          return (
            <g key={`p-${idx}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={portRadius}
                fill="#fff"
                stroke="currentColor"
                strokeWidth={Math.max(1, strokeWidth - 1)}
                vectorEffect="non-scaling-stroke"
              />
              {showPinNames && name && (
                <text
                  x={p.x + dx}
                  y={p.y + dy}
                  fontSize={11}
                  textAnchor={dx < 0 ? "end" : dx > 0 ? "start" : "middle"}
                  dominantBaseline={dy < 0 ? "baseline" : dy > 0 ? "hanging" : "middle"}
                  fill="currentColor"
                  style={{ userSelect: "none" }}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}
