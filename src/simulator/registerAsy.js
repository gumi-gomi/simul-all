// src/simulator/registerAsy.js

import React from "react";
import { DRAW_LIB } from "./drawLib";

// 🔥 전역 심볼 레지스트리
export const SYM_REGISTRY = {};

const NAME_MAP = {
  res: "resistor",
  res2: "resistor",
  cap: "capacitor",
  polcap: "capacitor",
  ind: "inductor",
  ind2: "inductor",
  voltage: "vsource",
  current: "isource",
  diode: "diode",
  zener: "diode",
  schottky: "diode",
  npn: "npn",
  pnp: "pnp",
  nmos: "nmos",
  pmos: "pmos",
  nfet: "nmos",
  pfet: "pmos",
};

function arcToPath(arc) {
  if (arc.mode === "points") {
    return `M ${arc.x1} ${arc.y1} A ${arc.r} ${arc.r} 0 0 1 ${arc.x2} ${arc.y2}`;
  }
  const { cx, cy, r, a1, a2 } = arc;
  const steps = 24;
  const toRad = (d) => (d * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = a1 + ((a2 - a1) * i) / steps;
    pts.push([cx + r * Math.cos(toRad(t)), cy + r * Math.sin(toRad(t))]);
  }
  return `M ${pts.map(([x, y]) => `${x} ${y}`).join(" L ")}`;
}

export function registerAsySymbol(key, parsed) {
  // 🔥 registry 저장
  SYM_REGISTRY[key] = parsed;

  // 파일명 매핑
  const mappedKey = NAME_MAP[key] || key;

  const ports = parsed.pins.map((p) => ({
    id: p.name || p.id,
    x: p.x,
    y: p.y,
  }));

  function draw({ x, y, rot }) {
    const cx = x + parsed.w / 2;
    const cy = y + parsed.h / 2;

    return (
      <g transform={`rotate(${rot},${cx},${cy})`} stroke="currentColor" fill="none">
        {parsed.shapes.map((s, i) => {
          switch (s.type) {
            case "line":
              return (
                <line
                  key={i}
                  x1={x + s.x1}
                  y1={y + s.y1}
                  x2={x + s.x2}
                  y2={y + s.y2}
                  strokeWidth="2"
                />
              );
            case "rect":
              return (
                <rect
                  key={i}
                  x={x + s.x}
                  y={y + s.y}
                  width={s.w}
                  height={s.h}
                  strokeWidth="2"
                />
              );
            case "circle":
              return (
                <circle key={i} cx={x + s.cx} cy={y + s.cy} r={s.r} strokeWidth="2" />
              );
            case "arc":
              return (
                <path
                  key={i}
                  d={arcToPath(s)}
                  transform={`translate(${x},${y})`}
                  strokeWidth="2"
                />
              );
            case "polyline":
              return (
                <polyline
                  key={i}
                  points={s.points.map((p) => `${x + p.x},${y + p.y}`).join(" ")}
                  strokeWidth="2"
                  fill="none"
                />
              );
            default:
              return null;
          }
        })}
      </g>
    );
  }

  // 🔥 DRAW_LIB에도 등록
  DRAW_LIB[mappedKey] = {
    w: parsed.w,
    h: parsed.h,
    ports,
    prefix: parsed.prefix,
    draw,
  };
}
