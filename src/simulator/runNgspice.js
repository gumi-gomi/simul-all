// src/simulator/runNgspice.js
export async function runNgspice(netlist) {
  const res = await fetch("/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ netlist }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Server error: ${res.status} ${msg}`);
  }

  // ngspice 결과(txt)를 그대로 반환 (App에서 parseTranData 사용)
  return await res.text();
}
