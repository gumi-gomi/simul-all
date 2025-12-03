// src/simulator/asyLoader.js
import { parseASY } from "./parseAsy";
import { registerAsySymbol, SYM_REGISTRY } from "./registerAsy";

/** 글로벌 노출 (드래그/드롭, 프리뷰에서 필요) */
window.ASY_SYMBOLS = SYM_REGISTRY;

/** 백슬래시 → 슬래시 변환 */
function norm(p) {
  return p.replace(/\\/g, "/");
}

/** index.json 전체 로딩 */
async function loadIndex() {
  const url = "/simul/symbols/index.json";  // ★ 정확함
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("index.json load failed: " + res.status);
  return await res.json();
}

/** 재귀적으로 모든 ASY 파일 로딩 */
async function scanNode(node, basePath) {
  for (const file of node.files || []) {
    if (!file.toLowerCase().endsWith(".asy")) continue;

    const fileUrl = `${basePath}/${norm(file)}`;
    try {
      const txt = await (await fetch(fileUrl)).text();
      const parsed = parseASY(txt);

      const key = file.replace(".asy", "").toLowerCase();
      registerAsySymbol(key, parsed);

    } catch (err) {
      console.warn("⚠ ASY LOAD FAIL:", fileUrl, err);
    }
  }

  for (const sub of node.folders || []) {
    const subPath = norm(sub.path);
    const fullUrl = "/simul/symbols/" + subPath;
    await scanNode(sub, fullUrl);
  }
}

/** 전체 심볼 로딩 엔트리 */
export async function loadAllSymbols() {
  const index = await loadIndex();
  const rootPath = norm(index.path);
  const rootUrl = "/simul/symbols/" + rootPath;
  await scanNode(index, rootUrl);
  return index;
}
