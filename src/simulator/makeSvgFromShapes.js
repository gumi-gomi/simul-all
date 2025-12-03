// src/simulator/makeSvgFromShapes.js
import React from "react";

/**
 * JSON.draw → SVG React 요소로 변환
 * 회전/이동/옵션(stroke, fill, strokeWidth)까지 모두 지원
 */
export function makeSvgFromShapes(json, el) {
  const { x, y, rot } = el;
  const w = json.w;
  const h = json.h;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rot || 0}, ${w / 2}, ${h / 2})`}>
      {json.draw?.map((shape, i) => {
        const stroke = shape.stroke ?? "currentColor";
        const strokeWidth = shape.strokeWidth ?? 2;
        const fill = shape.fill ?? "none";


        switch (shape.type) {
          case "line":
            return (
              <line
                key={i}
                x1={shape.x1}
                y1={shape.y1}
                x2={shape.x2}
                y2={shape.y2}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
            );

          case "polyline":
            return (
              <polyline
                key={i}
                points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
            );

          case "polygon":
            return (
              <polygon
                key={i}
                points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
            );

          case "circle":
            return (
              <circle
                key={i}
                cx={shape.cx}
                cy={shape.cy}
                r={shape.r}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
            );

          case "rect":
            return (
              <rect
                key={i}
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
            );

          case "path":
            return (
              <path
                key={i}
                d={shape.d}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
            );

          default:
            return null;
        }
      })}
    </g>
  );
}
