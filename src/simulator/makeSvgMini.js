// src/simulator/makeSvgMini.js
import React from "react";
import { DRAW_LIB } from "./drawLib";

export function makeMiniSymbol(type) {
  const def = DRAW_LIB[type];
  if (!def || !def.draw) return null;

  const scale = 0.35; // 아이콘 크기 조절

  return (
    <svg
      width={def.w * scale}
      height={def.h * scale}
      viewBox={`0 0 ${def.w} ${def.h}`}
      style={{ pointerEvents: "none" }}
    >
      {def.draw({ x: 0, y: 0, rot: 0 })}
    </svg>
  );
}
