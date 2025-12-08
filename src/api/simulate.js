export async function simulateCircuit(circuitJson, analyses) {
  const res = await fetch("http://localhost:4000/api/circuit/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: circuitJson,
      analyses
    }),
  });

  const data = await res.json();
  return data;
}
