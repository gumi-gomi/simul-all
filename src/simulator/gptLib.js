import { DRAW_LIB } from "./drawLib";

export const GPT_LIB = {};

export function rebuildGPTLib() {
  Object.entries(DRAW_LIB).forEach(([key, def]) => {
    GPT_LIB[key] = {
      name: def.name || key,
      ports: def.ports.map(p => p.id)
    };
  });

  console.log("🔥 Rebuilt GPT_LIB:", GPT_LIB);
}
