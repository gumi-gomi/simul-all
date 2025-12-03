// src/simulator/drawLib.js

// globalThis 폴리필
/* eslint-disable no-undef */
const getGlobal = () => {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  return {};
};

const g = getGlobal();

// 전역 싱글톤 보장
g.__ELECHUB_DRAW_LIB__ = g.__ELECHUB_DRAW_LIB__ || {};

export const DRAW_LIB = g.__ELECHUB_DRAW_LIB__;
