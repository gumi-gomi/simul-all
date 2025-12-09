import { DRAW_LIB } from "simulator/drawLib";

export async function loadJsonSymbolPackages() {
  try {
    // 모든 symbol 파일을 비동기 import (Vite 기능)
    const symbolModules = import.meta.glob("../symbols/*.js");

    // 👉 병렬 로딩 (Promise.all)
    const loadPromises = Object.entries(symbolModules).map(
      async ([path, loader]) => {
        try {
          const mod = await loader();
          const symbol = mod.default;

          if (!symbol || !symbol.name) {
            console.error("❌ Invalid symbol:", path, symbol);
            return null;
          }

          return { name: symbol.name, symbol };
        } catch (err) {
          console.error("❌ Error loading symbol:", path, err);
          return null;
        }
      }
    );

    // 병렬 처리 완료
    const results = await Promise.all(loadPromises);

    // DRAW_LIB에 등록
    results.forEach((item) => {
      if (!item) return;
      DRAW_LIB[item.name] = item.symbol;
    });

    console.log("🔥 DRAW_LIB loaded:", Object.keys(DRAW_LIB));
  } catch (e) {
    console.error("🚨 loadJsonSymbolPackages Fatal Error:", e);
  }
}
