import { DRAW_LIB } from "simulator/drawLib";

export async function loadJsonSymbolPackages() {
  const symbolModules = import.meta.glob("../symbols/*.js");

  for (const path in symbolModules) {
    const mod = await symbolModules[path]();
    const symbol = mod.default;

    if (!symbol || !symbol.name) {
      console.error("Invalid symbol:", path, symbol);
      continue;
    }

    DRAW_LIB[symbol.name] = symbol;
  }

  console.log("DRAW_LIB keys:", Object.keys(DRAW_LIB));
}
