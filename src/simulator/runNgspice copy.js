// src/simulator/runNgspice.js
export async function runNgspice(netlistText) {
  return new Promise(async (resolve, reject) => {
    try {
      // ngspice.v3.js WASM 로드
      const module = await window.NgSpiceModule({
        print: (txt) => console.log("[ngspice]", txt),
        printErr: (txt) => console.error("[ngspice-error]", txt),
        locateFile: (path) => process.env.PUBLIC_URL + "/ngspice.v3.wasm",
      });

      console.log("🔧 NGSPICE LOADED");

      // 임시 netlist 파일 생성
      const ptr = module.FS.writeFile("/tmp.cir", netlistText);

      // SPICE 실행
      let output = "";

      module.stdout = (txt) => {
        output += txt + "\n";
      };

      await module.callMain(["-b", "/tmp.cir"]);

      resolve(output);
    } catch (err) {
      reject(err);
    }
  });
}
