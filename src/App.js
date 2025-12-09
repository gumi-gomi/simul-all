// src/App.js
import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

import { generateNetlist } from "./simulator/generateNetlist";
import ChatPanel from "./components/ChatPanel";
import CircuitCanvas from "./components/CircuitCanvas";
import { DRAW_LIB } from "./simulator/drawLib";
import { loadJsonSymbolPackages } from "./simulator/jsonSymbolLoader";
import { rebuildGPTLib, GPT_LIB } from "./simulator/gptLib";
import { autoLayout } from "./simulator/autoLayout";
import { SYMBOL_CATEGORIES } from "./simulator/symbolCategories";
import { makeMiniSymbol } from "./simulator/makeSvgMini";
import { normalizeCircuitJson } from "./simulator/normalizeCircuit";



// 백엔드 NGSPICE 실행 API
import { simulateCircuit } from "./api/simulate";

const Simulbox = styled.div`
  width: 100%;
  max-width: 1340px;
  height: 600px;
  margin: 70px auto 10px;
  outline: 1px solid rgba(0,0,0,0.05);
  border-radius: 5px;
  box-shadow: 3px 3px 7px rgba(0,0,0,0.1);
  box-sizing: border-box;
  padding: 0 20px;
`;

const GRID = 10;
const snap = (v) => Math.round(v / GRID) * GRID;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

console.log("DRAW_LIB keys:", Object.keys(DRAW_LIB));

function getIdPrefix(type) {
  const map = {
    resistor: "R",
    capacitor: "C",
    inductor: "L",
    vsource: "V",
    ground: "G",
    diode: "D",
    led: "D",
    npn: "Q",
    pnp: "Q",
    nmos: "M",
    pmos: "M",
  };
  return map[type] || "X";
}

/* vsource 같은 복잡한 값 보정 */
function normalizeComponents(components) {
  return components.map((c) => {
    if (c.type === "vsource") {
      const wave = (c.waveType || "DC").toUpperCase();
      const toNum = (v, fb = 0) => {
        if (v === undefined || v === null) return fb;
        if (typeof v === "number") return v;
        const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
        return isNaN(n) ? fb : n;
      };

      if (wave === "DC") {
        return { ...c, waveType: "DC", dc: toNum(c.dc ?? c.value ?? 0) };
      }
    }
    return c;
  });
}

export default function App() {
  const [elements, setElements] = useState([]);
  const [wires, setWires] = useState([]);
  const [draggingType, setDraggingType] = useState(null);
  const [circuitJson, setCircuitJson] = useState({
    components: [
      { id: "V1", type: "vsource", dc: "5", waveType: "DC" },
      { id: "R1", type: "resistor", value: "1k" },
      { id: "GND1", type: "ground" }
    ],
    connections: [
      { from: "V1.+", to: "R1.1" },
      { from: "R1.2", to: "GND1.GND" },
      { from: "V1.-", to: "GND1.GND" }
    ]
  });

  const [result, setResult] = useState(null);
  const [search, setSearch] = useState("");

    const [symbolsLoaded, setSymbolsLoaded] = useState(false);

    
  async function handleSim() {
    if (!circuitJson) {
      alert("회로 JSON이 없습니다.");
      return;
    }

    const data = await simulateCircuit(circuitJson, {
      tran: { step: "1u", stop: "1m" }
    });

    setResult(data);
    console.log("Simulation Result:", data);
  }

 function handleCircuitGenerated(json) {
  setCircuitJson(json);

  const fixed = normalizeCircuitJson(json, DRAW_LIB);
  const components = normalizeComponents(fixed.components);
  const connections = fixed.connections;

  const elements = components.map((c) => ({
    id: c.id,
    type: c.type.toLowerCase(),
    value: c.value || "",
    rot: c.rot || 0,
    x: c.x || 0,
    y: c.y || 0,
    waveType: c.waveType,
    dc: c.dc
  }));

  const wires = connections.map((conn) => {
    const [elA, portA] = conn.from.split(".");
    const [elB, portB] = conn.to.split(".");
    return {
      id: "W_" + Math.random().toString(36).slice(2, 8),
      a: { el: elA, portId: portA },
      b: { el: elB, portId: portB }
    };
  });

  const laidOut = autoLayout(elements, wires);
  setElements(laidOut);
  setWires(wires);

  /* 🔥 여기 추가됨: 자동 시뮬레이션 실행 */
  setTimeout(() => {
    handleSim();
  }, 200);
}

  useEffect(() => {
    async function init() {
      console.log("🔥 Loading symbol packages...");
      await loadJsonSymbolPackages();

      console.log("🔥 Rebuilding GPT_LIB");
      rebuildGPTLib();

      console.log("🔥 Symbol loading finished. Keys:", Object.keys(DRAW_LIB));
      setSymbolsLoaded(true);
    }

    init();
  }, []);

    if (!symbolsLoaded) {
    return <div style={{ padding: 50 }}>⏳ Loading symbols...</div>;
  }


  return (
    <>
      {/* ChatPanel */}
      <div
        style={{
          width: "1340px",
          margin: "20px auto",
          borderRadius: "5px",
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)"
        }}
      >
        <ChatPanel onCircuitGenerated={handleCircuitGenerated} gptLib={GPT_LIB} />
      </div>

      {/* 메인 레이아웃 */}
      <div
        style={{
          width: "100%",
          margin: "0 auto",
          border: "1px solid #eee",
          borderRadius: "10px",
          background: "#fff",
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          height: "930px"
        }}
      >
        {/* Toolbox */}
        <aside
          style={{
            padding: 12,
            borderRight: "1px solid #eee",
            overflowY: "auto",
            background: "#f7f7f7"
          }}
        >
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "90%",
              padding: "6px 8px",
              marginBottom: 8,
              borderRadius: 4,
              border: "1px solid #ccc"
            }}
          />

          {SYMBOL_CATEGORIES.map((cat) => {
            const filteredItems = cat.items.filter((key) => {
              const name = DRAW_LIB[key]?.name || key;
              return (
                name.toLowerCase().includes(search.toLowerCase()) ||
                key.toLowerCase().includes(search.toLowerCase())
              );
            });

            if (filteredItems.length === 0) return null;

            return (
              <div key={cat.title} style={{ marginBottom: 15 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    padding: "4px 6px",
                    background: "#505a66",
                    color: "#fff",
                    borderRadius: 4,
                    marginBottom: 6
                  }}
                >
                  {cat.title}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 6
                  }}
                >
                  {filteredItems.map((key) => {
                    const def = DRAW_LIB[key];
                    if (!def) return null;

                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("type", key);
                          setDraggingType(key);
                        }}
                        onClick={() =>
                          setElements((els) => [
                            ...els,
                            {
                              id: uid(getIdPrefix(key)),
                              type: key,
                              x: 200,
                              y: 200,
                              rot: 0
                            }
                          ])
                        }
                        style={{
                          width: 55,
                          height: 55,
                          background: "#fff",
                          border: "1px solid #ccc",
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "grab"
                        }}
                        title={def.name || key}
                      >
                        {makeMiniSymbol(key)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Netlist 출력 */}
          <button
            style={{
              marginTop: 20,
              padding: "8px 10px",
              width: "100%",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: "#fafafa",
              cursor: "pointer"
            }}
            onClick={() => {
              try {
                const net = generateNetlist(elements, wires, DRAW_LIB);
                console.log("🔍 SPICE NETLIST\n" + net);
                alert("콘솔에서 SPICE netlist 확인 가능");
              } catch (err) {
                console.error("netlist error:", err);
              }
            }}
          >
            📝 Netlist 출력
          </button>
        </aside>

        {/* Canvas */}
        <CircuitCanvas
  elements={elements.filter(Boolean)}       // ⬅ undefined 제거
  setElements={(fn) =>
    setElements((prev) => fn(prev.filter(Boolean)))
  }
  wires={wires.filter(Boolean)}             // ⬅ undefined 제거
  setWires={(fn) =>
    setWires((prev) => fn(prev.filter(Boolean)))
  }
  draggingType={draggingType}
  setDraggingType={setDraggingType}
/>
      </div>

      {/* 시뮬레이션 결과 */}
      <Simulbox>
        <div style={{ padding: 16 }}>
          {/* <button onClick={handleSim}>⚡ 시뮬레이션 실행</button> */}
          <pre
            style={{
              marginTop: 16,
              background: "#f9f9f9",
              borderRadius: 6,
              height: "470px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              padding: "20px"
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      </Simulbox>
    </>
  );
}
