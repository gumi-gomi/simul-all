import { registerJsonSymbol } from "./registerJsonSymbol";
import { DRAW_LIB } from "./drawLib";


export async function loadJsonSymbolPackages() {
  const base = process.env.PUBLIC_URL + "/symbols";

  // index.json 가져오기
  const indexRes = await fetch(`${base}/index.json`);
  const list = await indexRes.json();  // ["resistor.json", "capacitor.json", ...]

  for (const file of list) {
    const res = await fetch(`${base}/${file}`);
    const json = await res.json();

    const name = json.name || file.replace(".json", "");
    registerJsonSymbol(name, json);
  }
}
