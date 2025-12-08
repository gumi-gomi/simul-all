import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import ReactDOMServer from "react-dom/server";
import { DRAW_LIB } from "../simulator/drawLib";

/** ===== 캔버스 공통 상수 ===== */
const GRID = 10;
const PORT_R = 4;

/** ===== 유틸 ===== */
const snap = (v) => Math.round(v / GRID) * GRID;
// 회전 금지 기본 리스트(기존 유지)
const NO_ROTATE = ["npn", "pnp", "nmos", "pmos", "opamp", "transformer"];

// ▶ raw 심볼 감지: def.mode === "raw" 또는 def.raw === true
function isRawSymbol(type) {
  const def = DRAW_LIB[type];
  return !!(def && (def.mode === "raw" || def.raw === true));
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
function getIdPrefix(type) {
  switch (type) {
    case "resistor": return "R";
    case "capacitor": return "C";
    case "inductor": return "L";
    case "vsource": return "V";
    case "ground": return "G";
    case "diode": return "D";
    case "led": return "D";
    case "npn": return "Q";
    case "pnp": return "Q";
    case "nmos": return "M";
    case "pmos": return "M";
    default: return "X";
  }
}

function manhattanLPath(a, b, prefer = "h") {
  return prefer === "h"
    ? [a.x, a.y, b.x, a.y, b.x, b.y]
    : [a.x, a.y, a.x, b.y, b.x, b.y];
}
function bestOrthogonal(a, b) {
  const pH = manhattanLPath(a, b, "h");
  const pV = manhattanLPath(a, b, "v");
  const len = (p) => Math.abs(p[2] - p[0]) + Math.abs(p[5] - p[1]);
  return len(pH) <= len(pV) ? pH : pV;
}

function rotatePointAroundCenter(rel, def, rotDeg) {
  const rad = (rotDeg * Math.PI) / 180;
  const cx = def.w / 2, cy = def.h / 2;
  const dx = rel.x - cx, dy = rel.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

// ▶ 원점 보정: raw 심볼은 스냅만 하고 보정/회전 기준 정렬 안 함
function alignOriginForPorts(type, rot, x, y) {
  const def = DRAW_LIB[type];
  if (!def) return { x, y };
  if (isRawSymbol(type)) {
    // raw: 사용자가 둔 좌표를 그대로, 그리드에만 맞춘다
    return { x: snap(x), y: snap(y) };
  }
  // 기존 보정 (첫 포트를 스냅 기준으로 정렬)
  const first = def.ports[0];
  const pr = rotatePointAroundCenter({ x: first.x, y: first.y }, def, rot);
  const wantX = snap(x + pr.x);
  const wantY = snap(y + pr.y);
  const dx = wantX - (x + pr.x);
  const dy = wantY - (y + pr.y);
  return { x: x + dx, y: y + dy };
}

function clientToSvg(evt, svgEl) {
  const pt = svgEl.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svgEl.getScreenCTM();
  const ipt = pt.matrixTransform(ctm.inverse());
  return { x: ipt.x, y: ipt.y };
}

/** ====== BBox 계산 ====== */
function computeElementBBox(el) {
  const def = DRAW_LIB[el.type];
  if (!def) return null;

  const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  tempSvg.setAttribute("width", 0);
  tempSvg.setAttribute("height", 0);
  tempSvg.style.position = "absolute";
  tempSvg.style.left = "-9999px";
  document.body.appendChild(tempSvg);

  let reactNode;

  // -----------------------------
  // ① draw가 함수(asy loading)인 경우
  // -----------------------------
  if (typeof def.draw === "function") {
    reactNode = def.draw(el);
  }

  // -----------------------------
  // ② draw가 JSON 배열인 경우 → makeSvgFromShapes 사용
  // -----------------------------
  else if (Array.isArray(def.draw)) {
    reactNode = (
      <g transform={`translate(${el.x}, ${el.y}) rotate(${el.rot || 0}, ${def.w / 2}, ${def.h / 2})`}>
        {def.draw.map((shape, i) =>
          React.createElement(
            shape.type,
            {
              key: i,
              ...shape,
              stroke: shape.stroke ?? "currentColor",
              fill: shape.fill ?? "none",
              strokeWidth: shape.strokeWidth ?? 2
            }
          )
        )}
      </g>
    );
  }

  // -----------------------------
  // ③ draw가 둘 다 아니다 → 오류 회피
  // -----------------------------
  else {
    console.error("Invalid draw format for:", el.type, def);
    document.body.removeChild(tempSvg);
    return { x: el.x, y: el.y, w: def.w, h: def.h };
  }

  tempSvg.innerHTML = `<g>${ReactDOMServer.renderToStaticMarkup(reactNode)}</g>`;
  const realG = tempSvg.firstChild;

  let box = { x: el.x, y: el.y, width: def.w, height: def.h };

  try {
    box = realG.getBBox();
  } catch (err) {
    console.warn("BBox failed for:", el.type, err);
  }

  document.body.removeChild(tempSvg);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}


/** ====== 메인 컴포넌트 ====== */
export default function CircuitCanvas({
  elements,
  setElements,
  wires,
  setWires,
  draggingType,
  setDraggingType,
}) {
  /** 로컬 상태 (캔버스 내부 인터랙션 전용) */
  const [selected, setSelected] = useState([]);
  const [drag, setDrag] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [box, setBox] = useState(null);
  const [boxStart, setBoxStart] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);

  const [viewportSize] = useState({ width: 1000, height: 800 });
  const [routingMode, setRoutingMode] = useState(null);
  const [startPt, setStartPt] = useState(null);

  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef(null);

  const svgRef = useRef(null);
  const bboxCache = useRef(new Map());

  /** BBox 캐시 */
  function getBBox(el) {
    const key = `${el.id}_${el.rot}_${el.x}_${el.y}`;
    if (bboxCache.current.has(key)) return bboxCache.current.get(key);
    const box = computeElementBBox(el);
    bboxCache.current.set(key, box);
    return box;
  }

  /** 포트 절대 위치 */
  function portAbsolutePosition(el, port) {
    const def = DRAW_LIB[el.type];
    if (!def) return { x: el.x, y: el.y };
    if (!port) {
      console.warn("Invalid port access:", el.type, el.id);
      return { x: el.x, y: el.y };
    }

    // ▶ raw 심볼: 회전/중심 보정 없이 JSON 좌표 그대로 + 스냅
    if (isRawSymbol(el.type)) {
      return {
        x: snap(el.x + port.x),
        y: snap(el.y + port.y),
      };
    }

    // ▶ 일반 심볼: 기존 회전 로직 그대로
    const rad = (el.rot * Math.PI) / 180;
    const cx = el.x + def.w / 2;
    const cy = el.y + def.h / 2;
    const dx = port.x - def.w / 2;
    const dy = port.y - def.h / 2;

    return {
      x: snap(cx + dx * Math.cos(rad) - dy * Math.sin(rad)),
      y: snap(cy + dx * Math.sin(rad) + dy * Math.cos(rad)),
    };
  }

  function getRotatedVoltagePolarity(el) {
    const def = DRAW_LIB[el.type];
    const plusPort = def.ports.find((p) => p.id === "+");
    const minusPort = def.ports.find((p) => p.id === "-");
    const pPlus = portAbsolutePosition(el, plusPort);
    const pMinus = portAbsolutePosition(el, minusPort);

    const rot = ((el.rot % 360) + 360) % 360;
    if (rot === 0)  return pPlus.y > pMinus.y ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    if (rot === 90) return pPlus.x > pMinus.x ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    if (rot === 180) return pPlus.y < pMinus.y ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    if (rot === 270) return pPlus.x < pMinus.x ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    return { vp: "+", vn: "-" };
  }

  function startPosOf(wireEnd) {
    const el = elements.find((e) => e.id === wireEnd.el);
    if (!el) return { x: 0, y: 0 };
    const def = DRAW_LIB[el.type];
    const port = def.ports.find((p) => p.id === wireEnd.portId);
    if (!port) {
      console.warn("Wire refers to missing port:", wireEnd);
      return { x: el.x, y: el.y };
    }
    return portAbsolutePosition(el, port);
  }

  function stableOrthogonalPath(a, b, mode) {
    if (!mode) return bestOrthogonal(a, b);
    if (mode === "h") return [a.x, a.y, b.x, a.y, b.x, b.y];
    if (mode === "v") return [a.x, a.y, a.x, b.y, b.x, b.y];
    return bestOrthogonal(a, b);
  }

  /** 와이어 추가(중복 방지) */
  const addWire = (a, b) => {
    const exists = wires.some(
      (w) =>
        (w.a.el === a.el &&
          w.a.portId === a.portId &&
          w.b.el === b.el &&
          w.b.portId === b.portId) ||
        (w.b.el === a.el &&
          w.b.portId === a.portId &&
          w.a.el === b.el &&
          w.a.portId === b.portId)
    );
    if (exists) return;
    setWires((ws) => [...ws, { id: uid("W"), a, b }]);
  };

  /** 마우스 핸들러 */
  const onMouseDownPart = (e, el) => {
    e.stopPropagation();
    const pt = clientToSvg(e, svgRef.current);

    if (!selected.includes(el.id)) {
      if (e.shiftKey) {
        setSelected((prev) =>
          prev.includes(el.id) ? prev.filter((x) => x !== el.id) : [...prev, el.id]
        );
      } else {
        setSelected([el.id]);
      }
    }

    const moveIds = selected.includes(el.id) ? [...selected] : [el.id];
    const startPositions = moveIds.map((id) => {
      const found = elements.find((it) => it.id === id);
      return { id, x: found.x, y: found.y, rot: found.rot, type: found.type };
    });

    setDrag({ ids: moveIds, startMouse: pt, startPositions });
    setInspector({ id: el.id, x: el.x, y: el.y });
  };

  const onMouseDownBoard = (e) => {
    const pt = clientToSvg(e, svgRef.current);
    setBoxStart(pt);
    setBox({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
  };

  const onMouseMove = (e) => {
    const pt = clientToSvg(e, svgRef.current);

    if (connectFrom) {
      setMousePos({ x: pt.x, y: pt.y });
      if (!routingMode && startPt) {
        const dx = Math.abs(pt.x - startPt.x);
        const dy = Math.abs(pt.y - startPt.y);
        if (dx > 10 || dy > 10) setRoutingMode(dx > dy ? "h" : "v");
      }
    }

    if (boxStart) {
      setMousePos({ x: pt.x, y: pt.y, event: e });
      setBox({ x1: boxStart.x, y1: boxStart.y, x2: pt.x, y2: pt.y });
      return;
    }

    if (!drag) return;

    const dx = snap(pt.x - drag.startMouse.x);
    const dy = snap(pt.y - drag.startMouse.y);

    let newPos = null;
    setElements((els) =>
      els.map((it) => {
        const start = drag.startPositions.find((s) => s.id === it.id);
        if (!start) return it;

        const rawX = start.x + dx;
        const rawY = start.y + dy;

        // ▶ raw 심볼은 원점 보정 제외(스냅만 유지)
        const aligned = isRawSymbol(start.type)
          ? { x: snap(rawX), y: snap(rawY) }
          : alignOriginForPorts(start.type, start.rot, rawX, rawY);

        if (inspector && inspector.id === it.id) {
          newPos = { x: aligned.x, y: aligned.y };
        }
        return { ...it, x: aligned.x, y: aligned.y };
      })
    );
    if (inspector && newPos) {
      setInspector((prev) => (prev ? { ...prev, x: newPos.x, y: newPos.y } : null));
    }
  };

  const onMouseUp = () => {
    if (box) {
      const x1 = Math.min(box.x1, box.x2);
      const y1 = Math.min(box.y1, box.y2);
      const x2 = Math.max(box.x1, box.x2);
      const y2 = Math.max(box.y1, box.y2);
     const ids = elements
  .filter((el) => 
    el.x >= x1 && el.x <= x2 &&
    el.y >= y1 && el.y <= y2
  )
  .map((el) => el.id);
      setSelected(ids);
      setBox(null);
      setBoxStart(null);
      return;
    }
    setDrag(null);
  };

  /** 키보드 */
  const handleKey = (e) => {
    if (e.key === "Escape") {
      setInspector(null);
      if (connectFrom) {
        setConnectFrom(null);
        setMousePos(null);
        setRoutingMode(null);
        setStartPt(null);
        return;
      }
      setWires((ws) =>
        ws.filter((w) => !selected.includes(w.a.el) && !selected.includes(w.b.el))
      );
      return;
    }
    if (e.key === "Delete") {
      setElements((els) => els.filter((it) => !selected.includes(it.id)));
      setWires((ws) =>
        ws.filter((w) => !selected.includes(w.a.el) && !selected.includes(w.b.el))
      );
      setSelected([]);
      return;
    }
    if (e.key === "r" || e.key === "R") {
      setElements((els) =>
        els.map((it) => {
          if (!selected.includes(it.id)) return it;
          // 회전 금지(기존 유지) + raw 심볼도 회전 금지
          if (NO_ROTATE.includes(it.type) || isRawSymbol(it.type)) return it;
          const nextRot = (it.rot + 90) % 360;
          const aligned = alignOriginForPorts(it.type, nextRot, it.x, it.y);
          return { ...it, rot: nextRot, x: aligned.x, y: aligned.y };
        })
      );
    }
  };

  /** 포트 연결 */
  const handlePortMouseDown = (e, elId, portId) => {
    e.stopPropagation();

    const el = elements.find((it) => it.id === elId);
    if (!el) return;
    const def = DRAW_LIB[el.type];
    const port = def?.ports?.find((p) => p.id === portId);
    if (!port) {
      console.warn("Clicked invalid port:", elId, portId);
      return;
    }

    if (connectFrom && connectFrom.elId === elId && connectFrom.portId === portId) {
      setConnectFrom(null);
      setMousePos(null);
      setRoutingMode(null);
      setStartPt(null);
      return;
    }

    if (!connectFrom) {
      const a = startPosOf({ el: elId, portId });
      setStartPt(a);
      setRoutingMode(null);
      setConnectFrom({ elId, portId });
      return;
    }

    addWire({ el: connectFrom.elId, portId: connectFrom.portId }, { el: elId, portId });
    setConnectFrom(null);
    setMousePos(null);
    setRoutingMode(null);
    setStartPt(null);
  };

  const handlePortMouseUp = (e, elId, portId) => {
    e.stopPropagation();

    const el = elements.find((it) => it.id === elId);
    if (!el) return;
    const def = DRAW_LIB[el.type];
    const port = def?.ports?.find((p) => p.id === portId);
    if (!port) {
      console.warn("Clicked invalid port:", elId, portId);
      return;
    }

    if (!connectFrom) return;
    if (connectFrom.elId === elId && connectFrom.portId === portId) return;

    addWire({ el: connectFrom.elId, portId: connectFrom.portId }, { el: elId, portId });
    setRoutingMode(null);
    setStartPt(null);
    setConnectFrom(null);
    setMousePos(null);
  };

  /** 휠 줌 (Shift + wheel) */
  const handleWheel = useCallback(
    (e) => {
      if (!e.shiftKey) return;
      e.preventDefault();

      const zoomIntensity = 0.0015;
      const delta = -e.deltaY;

      const newZoom = Math.max(0.2, Math.min(4, zoom + delta * zoomIntensity));
      if (newZoom === zoom) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const svgX = (clientX - pan.x) / zoom;
      const svgY = (clientY - pan.y) / zoom;

      const newPanX = clientX - svgX * newZoom;
      const newPanY = clientY - svgY * newZoom;

      setPan({ x: newPanX, y: newPanY });
      setZoom(newZoom);
    },
    [zoom, pan]
  );

  /** SVG 루트 핸들러 (패닝 포함) */
  const handleSvgMouseDown = (e) => {
    setInspector(null);

    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();

      const rect = e.currentTarget.getBoundingClientRect();
      const startClientX = e.clientX - rect.left;
      const startClientY = e.clientY - rect.top;

      panStart.current = {
        clientX: startClientX,
        clientY: startClientY,
        svgPanX: pan.x,
        svgPanY: pan.y,
      };

      setIsPanning(true);
      return;
    }

    onMouseDownBoard(e);
  };

  const handleSvgMouseMove = (e) => {
    if (isPanning) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const dx = (clientX - panStart.current.clientX) / zoom;
      const dy = (clientY - panStart.current.clientY) / zoom;

      setPan({
        x: panStart.current.svgPanX + dx,
        y: panStart.current.svgPanY + dy,
      });

      return;
    }

    onMouseMove(e);
  };

  const handleSvgMouseUp = () => {
    setIsPanning(false);
    onMouseUp();
  };

  /** 그리드 */
  const gridLines = useMemo(() => {
    const lines = [];
    const vbX = -pan.x / zoom;
    const vbY = -pan.y / zoom;
    const vbW = viewportSize.width / zoom;
    const vbH = viewportSize.height / zoom;
    const PAD = GRID * 200;

    const startX = Math.floor((vbX - PAD) / GRID) * GRID;
    const endX = Math.ceil((vbX + vbW + PAD) / GRID) * GRID;
    const startY = Math.floor((vbY - PAD) / GRID) * GRID;
    const endY = Math.ceil((vbY + vbH + PAD) / GRID) * GRID;

    for (let x = startX; x <= endX; x += GRID) {
      lines.push(
        <line
          key={`gx-${startX}-${endX}-${x}`}
          x1={x}
          y1={startY}
          x2={x}
          y2={endY}
          stroke="#f0f0f0"
        />
      );
    }
    for (let y = startY; y <= endY; y += GRID) {
      lines.push(
        <line
          key={`gy-${startY}-${endY}-${y}`}
          x1={startX}
          y1={y}
          x2={endX}
          y2={y}
          stroke="#f0f0f0"
        />
      );
    }
    return lines;
  }, [pan, zoom, viewportSize]);

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKey}
      style={{ width: "100%", height: "100%", outline: "none", position: "relative" }}
      onWheel={handleWheel}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${viewportSize.width / zoom} ${viewportSize.height / zoom}`}
        onMouseLeave={handleSvgMouseUp}
        style={{ zIndex: 1, background: "#fff" }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onDragOver={(e) => {
          e.preventDefault();
          const pt = clientToSvg(e, svgRef.current);
          setDragPreview({ x: snap(pt.x), y: snap(pt.y) });
        }}
        onDrop={(e) => {
          e.preventDefault();
          const type = e.dataTransfer.getData("type");
          if (!DRAW_LIB[type]) {
            console.error("Unknown type:", type);
            return;
          }
          const pt = clientToSvg(e, svgRef.current);
          const x = snap(pt.x);
          const y = snap(pt.y);

          // ▶ raw 심볼이면 원점 보정 없이 배치(스냅만)
          const pos = isRawSymbol(type)
            ? { x, y }
            : alignOriginForPorts(type, 0, x, y);

          setElements((els) => [
            ...els,
            { id: uid(getIdPrefix(type)), type, x: pos.x, y: pos.y, rot: 0, value: "" },
          ]);
          setDragPreview(null);
          if (setDraggingType) setDraggingType(null);
        }}
        onDragLeave={() => setDragPreview(null)}
      >
        {dragPreview && draggingType && (
          <g style={{ opacity: 0.4, pointerEvents: "none" }}>
            {DRAW_LIB[draggingType].draw({ x: dragPreview.x, y: dragPreview.y, rot: 0 })}
          </g>
        )}

        <g>{gridLines.map((ln) => ln)}</g>

        {wires.map((w) => {
          const a = startPosOf(w.a);
          const b = startPosOf(w.b);
          if (!a || !b) return null;
          const pts = bestOrthogonal(a, b);
          const d = `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]} L ${pts[4]} ${pts[5]}`;
          return (
            <path
              key={w.id}
              d={d}
              stroke="currentColor"
              strokeWidth={2}
              fill="none"
              onClick={(e) => {
                e.stopPropagation();
                setWires((ws) => ws.filter((it) => it.id !== w.id));
              }}
            />
          );
        })}

        {connectFrom && mousePos && (() => {
          const a = startPosOf({ el: connectFrom.elId, portId: connectFrom.portId });
          const b = { x: mousePos.x, y: mousePos.y };
          const pts = stableOrthogonalPath(a, b, routingMode);
          return (
            <path
              key="connecting-wire-preview"
              d={`M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]} L ${pts[4]} ${pts[5]}`}
              stroke="#2b8cff"
              strokeWidth={2}
              fill="none"
              strokeDasharray="6 6"
            />
          );
        })()}

        {elements.map((el) => (
          <g
            key={el.id}
            style={{
              color: selected.includes(el.id) ? "#2b8cff" : "currentColor",
            }}
          >
            {(() => {
              const box = getBBox(el);
              const draggingThis = !!(drag && drag.ids && drag.ids.includes(el.id));
              return (
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  fill="transparent"
                  pointerEvents="all"
                  onMouseDown={(e) => onMouseDownPart(e, el)}
                  style={{ cursor: draggingThis ? "grabbing" : "grab" }}
                />
              );
            })()}

            {DRAW_LIB[el.type].draw(el)}

            {/* RefDes 표시 */}
            <text
              x={el.x + DRAW_LIB[el.type].w / 2}
              y={el.y + DRAW_LIB[el.type].h + 2}
              textAnchor="middle"
              fontSize="12"
              fill={selected.includes(el.id) ? "#2b8cff" : "#555"}
              style={{ userSelect: "none" }}
            >
              {(() => {
                const map = {
                  resistor: "R", capacitor: "C", inductor: "L",
                  vsource: "V", ground: "G",
                  diode: "D",  led: "D",
                  npn: "Q",    pnp: "Q",
                  nmos: "M",   pmos: "M",
                };
                const prefix = map[el.type] || "X";
                const index = elements.filter((e) => e.type === el.type).indexOf(el) + 1;
                return `${prefix}${index}`;
              })()}
            </text>

            {/* value / 파형 표시 */}
            <text
              x={el.x + DRAW_LIB[el.type].w / 2}
              y={el.y + DRAW_LIB[el.type].h + 16}
              textAnchor="middle"
              fontSize="12"
              fill={selected.includes(el.id) ? "#2b8cff" : "#333"}
              style={{ userSelect: "none" }}
            >
              {(() => {
               if (el.type === "vsource") {
  const wave = (el.waveType || "DC").toUpperCase();

  switch (wave) {
    case "DC":
      return `DC ${el.dc ?? 0}V`;

    case "AC":
      return `AC(${el.acMag ?? 1}, ${el.acPhase ?? 0}°)`;

    case "SIN":
      return `SIN(${el.sin?.offset ?? 0}, ${el.sin?.amp ?? 1}, ${el.sin?.freq ?? 60})`;

    case "PULSE":
      return `PULSE(${el.pulse?.v1 ?? 0}→${el.pulse?.v2 ?? 5})`;

    case "EXP":
      return `EXP(${el.exp?.v1 ?? 0}→${el.exp?.v2 ?? 5})`;

    case "PWL":
      return `PWL(...)`;

    default:
      return `Vsrc`;
  }
}

                if (el.type === "resistor")  return `${el.value ?? ""}Ω`;
                if (el.type === "capacitor") return `${el.value ?? ""}F`;
                if (el.type === "inductor")  return `${el.value ?? ""}H`;
                return el.value ?? "";
              })()}
            </text>

            {/* 포트 */}
            {(DRAW_LIB[el.type].ports || []).map((p) => {
              if (!p || p.x === undefined || p.y === undefined) {
                console.warn("Invalid port in symbol:", el.type, p);
                return null;
              }
              const { x: rx, y: ry } = portAbsolutePosition(el, p);
              return (
                <circle
                  key={`${el.id}-${p.id}`}
                  cx={rx}
                  cy={ry}
                  r={PORT_R}
                  fill={
                    connectFrom && connectFrom.elId === el.id && connectFrom.portId === p.id
                      ? "#2b8cff"
                      : "#fff"
                  }
                  stroke="#2b8cff"
                  strokeWidth={2}
                  onMouseDown={(e) => handlePortMouseDown(e, el.id, p.id)}
                  onMouseUp={(e) => handlePortMouseUp(e, el.id, p.id)}
                  style={{ cursor: "crosshair" }}
                />
              );
            })}
          </g>
        ))}

        {/* 박스 선택 */}
        {box && (
          <rect
            x={Math.min(box.x1, box.x2)}
            y={Math.min(box.y1, box.y2)}
            width={Math.abs(box.x2 - box.x1)}
            height={Math.abs(box.y2 - box.y1)}
            fill="rgba(43,140,255,0.1)"
            stroke="#2b8cff"
            strokeDasharray="4 2"
          />
        )}
      </svg>

      {inspector && (
        <InspectorPopup
          inspector={inspector}
          elements={elements}
          setElements={setElements}
          setInspector={setInspector}
          pan={pan}
          zoom={zoom}
          bbox={getBBox(elements.find(e => e.id === inspector.id))}
        />
      )}
    </div>
  );
}

/** ====== 인스펙터 팝업 ====== */
function InspectorPopup({ inspector, elements, setElements, setInspector, pan, zoom, bbox }) {
  const el = elements.find((e) => e.id === inspector.id);
  if (!el) return null;

  const screenX = (bbox.x + bbox.w / 2) * zoom + pan.x;
  const screenY = (bbox.y + 10) * zoom + pan.y;

  const updateField = (patch) => {
    setElements((els) => els.map((it) => (it.id === el.id ? { ...it, ...patch } : it)));
  };

  const NO_VALUE = [
    "ground", "npn", "pnp", "nmos", "pmos",
    "opamp", "transformer", "diode", "led", "zener"
  ];

  const inputStyle = {
    width: "90%",
    padding: "3px",
    fontSize: 12,
  };

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: "translate(-50%, -100%)",
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 6,
        padding: 10,
        fontSize: 12,
        zIndex: 1000,
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        minWidth: 220,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: "bold", marginBottom: 8 }}>{el.id}</div>

      {/* -----------------------------  
          일반 component VALUE 입력
      ------------------------------ */}
      {!NO_VALUE.includes(el.type) && el.type !== "vsource" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "80px 1fr",
          gap: 6,
          marginBottom: 10,
        }}>
          <div>Value</div>
          <input
            style={inputStyle}
            value={el.value || ""}
            onChange={(e) => updateField({ value: e.target.value })}
          />
        </div>
      )}

      {/* -----------------------------
          VSOURCE 전용 UI
      ------------------------------ */}
      {el.type === "vsource" && (
        <>
          {/* Wave Type */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "80px 1fr",
            gap: 6,
            marginBottom: 10,
          }}>
            <div>Wave</div>
            <select
              style={inputStyle}
              value={el.waveType || "DC"}
              onChange={(e) => updateField({ waveType: e.target.value })}
            >
              <option value="DC">DC</option>
              <option value="AC">AC</option>
              <option value="SIN">SIN</option>
            </select>
          </div>

          {/* DC MODE */}
          {(el.waveType || "DC") === "DC" && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "80px 1fr",
              gap: 6,
              marginBottom: 10,
            }}>
              <div>DC (V)</div>
              <input
                style={inputStyle}
                value={el.dc ?? ""}
                onChange={(e) => updateField({ dc: e.target.value })}
              />
            </div>
          )}

          {/* AC MODE */}
          {(el.waveType || "DC") === "AC" && (
            <>
              <div style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr",
                gap: 6,
                marginBottom: 10,
              }}>
                <div>AC Mag</div>
                <input
                  style={inputStyle}
                  value={el.acMag ?? ""}
                  onChange={(e) => updateField({ acMag: e.target.value })}
                />
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr",
                gap: 6,
                marginBottom: 10,
              }}>
                <div>AC Phase</div>
                <input
                  style={inputStyle}
                  value={el.acPhase ?? ""}
                  onChange={(e) => updateField({ acPhase: e.target.value })}
                />
              </div>
            </>
          )}

          {/* SIN MODE */}
          {(el.waveType || "DC") === "SIN" && (
            <>
              {[
                ["offset", "Offset"],
                ["amp", "Amplitude"],
                ["freq", "Freq (Hz)"],
                ["td", "Delay"],
                ["theta", "Theta"],
                ["phi", "Phase"],
              ].map(([key, label]) => (
                <div
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr",
                    gap: 6,
                    marginBottom: 10,
                  }}
                >
                  <div>{label}</div>
                  <input
                    style={inputStyle}
                    value={el.sin?.[key] ?? ""}
                    onChange={(e) =>
                      updateField({
                        sin: { ...el.sin, [key]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* === 전원(UI) === */}
{el.type === "vsource" && (
  <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 6, marginBottom: 10 }}>
    <div>Wave</div>
    <select
      value={el.waveType || "DC"}
      onChange={(e) => updateField({ waveType: e.target.value })}
      style={{ padding: "3px" }}
    >
      <option value="DC">DC</option>
      <option value="AC">AC</option>
      <option value="SIN">SIN</option>
    </select>

    {/* DC */}
    {(el.waveType || "DC") === "DC" && (
      <>
        <div>DC (V)</div>
        <input
          value={el.dc ?? el.value ?? ""}
          onChange={(e) => updateField({ dc: e.target.value })}
          style={{ padding: "3px" }}
        />
      </>
    )}

    {/* AC */}
    {(el.waveType || "DC") === "AC" && (
      <>
        <div>Mag</div>
        <input
          value={el.acMag ?? el.value ?? 1}
          onChange={(e) => updateField({ acMag: e.target.value })}
          style={{ padding: "3px" }}
        />
        <div>Phase (°)</div>
        <input
          value={el.acPhase ?? 0}
          onChange={(e) => updateField({ acPhase: e.target.value })}
          style={{ padding: "3px" }}
        />
      </>
    )}

    {/* SIN */}
    {(el.waveType || "DC") === "SIN" && (
      <>
        <div>Offset</div>
        <input
          value={el.sin?.offset ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), offset: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Amp</div>
        <input
          value={el.sin?.amp ?? el.value ?? 1}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), amp: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Freq (Hz)</div>
        <input
          value={el.sin?.freq ?? 60}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), freq: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Delay</div>
        <input
          value={el.sin?.td ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), td: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Theta</div>
        <input
          value={el.sin?.theta ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), theta: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Phase</div>
        <input
          value={el.sin?.phi ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), phi: e.target.value } })}
          style={{ padding: "3px" }}
        />
      </>
    )}
  </div>
)}

{el.type === "isource" && (
  <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 6, marginBottom: 10 }}>
    <div>Wave</div>
    <select
      value={el.waveType || "DC"}
      onChange={(e) => updateField({ waveType: e.target.value })}
      style={{ padding: "3px" }}
    >
      <option value="DC">DC</option>
      <option value="AC">AC</option>
      <option value="SIN">SIN</option>
    </select>

    {(el.waveType || "DC") === "DC" && (
      <>
        <div>DC (A)</div>
        <input
          value={el.dc ?? el.value ?? ""}
          onChange={(e) => updateField({ dc: e.target.value })}
          style={{ padding: "3px" }}
        />
      </>
    )}

    {(el.waveType || "DC") === "AC" && (
      <>
        <div>Mag</div>
        <input
          value={el.acMag ?? el.value ?? 1}
          onChange={(e) => updateField({ acMag: e.target.value })}
          style={{ padding: "3px" }}
        />
        <div>Phase (°)</div>
        <input
          value={el.acPhase ?? 0}
          onChange={(e) => updateField({ acPhase: e.target.value })}
          style={{ padding: "3px" }}
        />
      </>
    )}

    {(el.waveType || "DC") === "SIN" && (
      <>
        <div>Offset</div>
        <input
          value={el.sin?.io ?? el.sin?.offset ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), io: e.target.value, offset: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Amp</div>
        <input
          value={el.sin?.ia ?? el.sin?.amp ?? el.value ?? 1e-3}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), ia: e.target.value, amp: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Freq (Hz)</div>
        <input
          value={el.sin?.freq ?? 60}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), freq: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Delay</div>
        <input
          value={el.sin?.td ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), td: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Theta</div>
        <input
          value={el.sin?.theta ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), theta: e.target.value } })}
          style={{ padding: "3px" }}
        />
        <div>Phase</div>
        <input
          value={el.sin?.phi ?? 0}
          onChange={(e) => updateField({ sin: { ...(el.sin||{}), phi: e.target.value } })}
          style={{ padding: "3px" }}
        />
      </>
    )}
  </div>
)}


      {/* Rotate (vsource 제외) */}
      <button
        style={{
          width: "100%",
          marginTop: 10,
          padding: "6px 0",
          border: "1px solid #aaa",
          borderRadius: 4,
          background: "#f5f5f5",
          cursor: "pointer",
        }}
        onClick={() => {
          if (
            ["npn", "pnp", "nmos", "pmos", "opamp", "transformer"].includes(el.type)
          )
            return;
          updateField({ rot: (el.rot + 90) % 360 });
        }}
      >
        Rotate
      </button>
    </div>
  );
}
