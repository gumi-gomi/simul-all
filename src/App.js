// src/App.js
import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { generateNetlist } from "./simulator/generateNetlist";
import ChatPanel from "./components/ChatPanel";
import CircuitCanvas from "./components/CircuitCanvas";
import { DRAW_LIB } from "./simulator/drawLib";
import { loadJsonSymbolPackages } from "./simulator/jsonSymbolLoader";
import { rebuildGPTLib, GPT_LIB } from "./simulator/gptLib";
import { runNgspice } from "./simulator/runNgspice";
import { autoLayout } from "./simulator/autoLayout";
import { SYMBOL_CATEGORIES } from "./simulator/symbolCategories";
import { makeMiniSymbol } from "./simulator/makeSvgMini";


/* ========= 시뮬레이션 박스 스타일 ========= */
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

const GraphBox = styled.div`
  width: 100%;
  max-width: 1300px;
  height: 500px;
  margin: 20px auto 60px;
  outline: 1px solid rgba(0,0,0,0.05);
  border-radius: 5px;
  box-shadow: 3px 3px 7px rgba(0,0,0,0.1);
  background: #fff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 20px;
`;

const GRID = 10;
const snap = (v) => Math.round(v / GRID) * GRID;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

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



/* ========= Transient 데이터 파싱 ========= */
function parseTranData(output) {
  if (!output) return [];
  const rawLines = output.split("\n");

  const headerIdx = rawLines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("index")
  );
  if (headerIdx === -1) return [];

  const headerLine = rawLines[headerIdx].trim();
  let headers = headerLine.split(/\s+/);

  const headerCount = {};
  headers = headers.map((h) => {
    const key = h.toLowerCase();
    if (!headerCount[key]) headerCount[key] = 1;
    else headerCount[key]++;
    return headerCount[key] === 1 ? key : `${key}${headerCount[key]}`;
  });

  const data = [];

  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line.startsWith("===") || /^-{3,}$/.test(line)) continue;

    if (!/^\d+/.test(line)) continue;

    const parts = line.split(/\s+/);
    const row = {};

    headers.forEach((h, idx) => {
      if (h === "index") return;
      const key = h.replace(/[^\w]/g, "_");
      const num = parseFloat(parts[idx]);
      row[key] = Number.isNaN(num) ? 0 : num;
    });

    data.push(row);
  }

  return data;
}

/* ========= 그래프 컴포넌트 ========= */
function SimulationGraph({ simOutput }) {
  const [data, setData] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);

  useEffect(() => {
    if (!simOutput) return;
    const parsed = parseTranData(simOutput);
    setData(parsed);

    if (parsed.length > 0) {
      const keys = Object.keys(parsed[0]).filter((k) => k.toLowerCase() !== "time");
      setSelectedKeys(keys.slice(0, 2));
    }
  }, [simOutput]);

  if (!data.length) return <div style={{ color: "#999" }}>그래프 없음</div>;

  const allKeys = Object.keys(data[0]).filter(
    (k) => k.toLowerCase() !== "time" && k.toLowerCase() !== "time2"
  );
  const colors = ["#007bff", "#ff4081", "#4caf50", "#ff9800", "#9c27b0"];

  return (
    <div style={{ width: "100%", maxWidth: 1200 }}>
      <h3 style={{ marginBottom: 10 }}>📈 Transient 파형 그래프</h3>

      {/* 체크박스 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 15, flexWrap: "wrap" }}>
        {allKeys.map((key) => (
          <label key={key} style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={selectedKeys.includes(key)}
              onChange={() =>
                setSelectedKeys((prev) =>
                  prev.includes(key)
                    ? prev.filter((p) => p !== key)
                    : [...prev, key]
                )
              }
            />{" "}
            {key}
          </label>
        ))}
      </div>

      <LineChart width={1100} height={380} data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" />
        <YAxis />
        <Tooltip />
        <Legend />
        {selectedKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={colors[i % colors.length]}
            dot={false}
          />
        ))}
      </LineChart>
    </div>
  );
}

function useForceUpdate() {
  const [, setTick] = useState(0);
  return () => setTick(t => t + 1);
}


/* ===============================================================
   ★★★ 메인 App.js ★★★
   캔버스 로직 없음 — CircuitCanvas 에 모두 위임됨
=============================================================== */
export default function App() {
  const forceUpdate = useForceUpdate();
  const [elements, setElements] = useState([]);
  const [wires, setWires] = useState([]);
  const [draggingType, setDraggingType] = useState(null);
  const [simOutput, setSimOutput] = useState("");
  const [circuit, setCircuit] = useState(null);
  const [search, setSearch] = useState("");


  function handleCircuitGenerated(json) {
  const { components, connections } = json;

  const elements = components.map(c => ({
    id: c.id,
    type: c.type.toLowerCase(),
    value: c.value || "",
    rot: 0,
    x: 0,
    y: 0,
    ...c,
  }));

  const wires = connections.map(conn => {
    const [elA, portA] = conn.from.split(".");
    const [elB, portB] = conn.to.split(".");
    return {
      id: "W_" + Math.random().toString(36).slice(2, 8),
      a: { el: elA, portId: portA },
      b: { el: elB, portId: portB },
    };
  });

  const laidOut = autoLayout(elements, wires);

  setElements(laidOut);
  setWires(wires);
}


  /* ===== JSON 심볼 로드 ===== */
  useEffect(() => {
    async function init() {
      await loadJsonSymbolPackages();
      rebuildGPTLib();
     /*  console.log("Loaded JSON symbols:", Object.keys(DRAW_LIB));
      console.log("GPT_LIB keys:", Object.keys(GPT_LIB)); */
       forceUpdate();
    }
    init();
  }, []);

  /* ===== GPT → elements/wires 변환 ===== */
  useEffect(() => {
    if (!circuit) return;

    const { components = [], connections = [] } = circuit;
    const safeComponents = components.filter((c) =>
      DRAW_LIB[c.type?.toLowerCase()]
    );

    const safeConnections = connections.filter((conn) => {
      const [a] = conn.from.split(".");
      const [b] = conn.to.split(".");
      return (
        safeComponents.find((x) => x.id === a) &&
        safeComponents.find((x) => x.id === b)
      );
    });

    let newElements = safeComponents.map((c) => ({
      ...c,
      type: c.type.toLowerCase(),
      x: snap(c.x || 200),
      y: snap(c.y || 200),
      rot: c.rot || 0,
    }));

    const newWires = safeConnections.map((conn) => {
      const [elA, portA] = conn.from.split(".");
      const [elB, portB] = conn.to.split(".");
      return {
        id: uid("W"),
        a: { el: elA, portId: portA },
        b: { el: elB, portId: portB },
      };
    });

    setElements(newElements);
    setWires(newWires);
  }, [circuit]);

  /* ===== Netlist 생성 ===== */

 
async function runSimulation() {
  try {
    const netlist = generateNetlist(elements, wires, DRAW_LIB);
    setSimOutput("⏳ 시뮬레이션 실행중...\n\n" + netlist);

    const result = await runNgspice(netlist);

    setSimOutput(result);
    console.log("NGSPICE RESULT:", result);
  } catch (err) {
    setSimOutput("❌ 시뮬레이션 실패\n" + err.toString());
  }
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
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        <ChatPanel onCircuitGenerated={handleCircuitGenerated} />
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
          height: "930px",
        }}
      >
        {/* ==== Toolbox ==== */}
      <aside
  style={{
    padding: 12,
    borderRight: "1px solid #eee",
    overflowY: "auto",
    background: "#f7f7f7",
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
    border: "1px solid #ccc",
  }}
/>

  {SYMBOL_CATEGORIES.map((cat) => {

  // 🔎 검색 필터 적용
  const filteredItems = cat.items.filter(key => {
    const name = DRAW_LIB[key]?.name || key;
    return name.toLowerCase().includes(search.toLowerCase()) ||
           key.toLowerCase().includes(search.toLowerCase());
  });

  // 검색 결과가 없으면 카테고리 전체 숨김
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
          marginBottom: 6,
        }}
      >
        {cat.title}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
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
                    rot: 0,
                  },
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
                cursor: "grab",
                transition: "0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#eef3ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
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

</aside>


        {/* ==== Canvas ==== */}
        <CircuitCanvas
          elements={elements}
          setElements={setElements}
          wires={wires}
          setWires={setWires}
          draggingType={draggingType}
          setDraggingType={setDraggingType}
        />
      </div>

      {/* ==== 시뮬레이션 출력 ==== */}
   {/*    <Simulbox>
        <div style={{ padding: 16 }}>
          <button onClick={runSimulation}>⚡ 시뮬레이션 실행</button>
          <pre
            style={{
              marginTop: 16,
              background: "#f9f9f9",
              borderRadius: 6,
              height: "470px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              padding: "20px",
            }}
          >
            {simOutput || "시뮬레이션 결과가 여기에 표시됩니다."}
          </pre>
        </div>
      </Simulbox> */}

      {/* ==== 그래프 ==== */}
    {/*   <GraphBox>
        <SimulationGraph simOutput={simOutput} />
      </GraphBox> */}
    </>
  );
}
