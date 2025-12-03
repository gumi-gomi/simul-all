import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import styled from "styled-components";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import ReactDOMServer from "react-dom/server";
import ChatPanel from "./components/ChatPanel";
import CircuitCanvas from "./components/CircuitCanvas";
// import GPT_LIB from "./simulator/lib"

async function loadNgspice() {
  const script = document.createElement("script");
  script.src = process.env.PUBLIC_URL + "/ngspice.v3.js";
  document.body.appendChild(script);
  await new Promise((res, rej) => {
    script.onload = res;
    script.onerror = rej;
  });

  return (args) =>
    window.NgSpiceModule({
      ...args,
      locateFile: (path) => process.env.PUBLIC_URL + "/ngspice.v3.wasm",
    });
}

function getIdPrefix(type) {
  switch (type) {
    case "resistor": return "R";
    case "capacitor": return "C";
    case "inductor": return "L";
    case "vsource": return "V";
    case "ground": return "G";
    case "diode": return "D";
    case "led": return "D";
    case "npn": return "Q";
    case "pnp": return "Q";
    case "nmos": return "M";
    case "pmos": return "M";
    default: return "X";
  }
}

const GRID = 10;
const PORT_R = 4;

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

const snap = (v) => Math.round(v / GRID) * GRID;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function manhattanLPath(a, b, prefer = "h") {
  return prefer === "h"
    ? [a.x, a.y, b.x, a.y, b.x, b.y]
    : [a.x, a.y, a.x, b.y, b.x, b.y];
}

function bestOrthogonal(a, b) {
  const pH = manhattanLPath(a, b, "h");
  const pV = manhattanLPath(a, b, "v");
  const len = (p) => Math.abs(p[2] - p[0]) + Math.abs(p[5] - p[1]);
  return len(pH) <= len(pV) ? pH : pV;
}

/** --- 부품 라이브러리 --- */
const DRAW_LIB = {
  resistor: {
    w: 100,
    h: 40,
    ports: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 100, y: 0 },
    ],
    draw: ({ x, y, rot }) => (
      <g transform={`rotate(${rot},${x + 50},${y + 20})`}>
        <line x1={x} y1={y} x2={x + 20} y2={y} strokeWidth={2} stroke="currentColor" />
        <polyline
          points={`${x + 20},${y} ${x + 28},${y - 14} ${x + 40},${y + 14} ${x + 52},${y - 14} ${x + 64},${y + 14} ${x + 76},${y - 14} ${x + 81},${y}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
        />
        <line x1={x + 80} y1={y} x2={x + 100} y2={y} strokeWidth={2} stroke="currentColor" />
      </g>
    ),
  },
  capacitor: {
    w: 80,
    h: 40,
    ports: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 80, y: 0 },
    ],
    draw: ({ x, y, rot }) => (
      <g transform={`rotate(${rot},${x + 40},${y + 20})`}>
        <line x1={x} y1={y} x2={x + 30} y2={y} strokeWidth={2} stroke="currentColor" />
        <line x1={x + 35} y1={y - 15} x2={x + 35} y2={y + 15} strokeWidth={2} stroke="currentColor" />
        <line x1={x + 45} y1={y - 15} x2={x + 45} y2={y + 15} strokeWidth={2} stroke="currentColor" />
        <line x1={x + 50} y1={y} x2={x + 80} y2={y} strokeWidth={2} stroke="currentColor" />
      </g>
    ),
  },
 inductor: {
  w: 100,
  h: 40,
  ports: [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 100, y: 0 },
  ],
  draw: ({ x, y, rot, id }) => (
    <g transform={`rotate(${rot},${x + 50},${y + 20})`}>
      <line x1={x} y1={y} x2={x + 10} y2={y} strokeWidth={2} stroke="currentColor" />

      {[0, 1, 2, 3].map((i) => (
        <path
          key={`coil-${i}`}   // 🔥 여기만 바꿔주면 됨
          d={`M ${x + 10 + i * 18} ${y} c 0 -10, 18 -10, 18 0 c 0 10, -18 10, -18 0`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
        />
      ))}

      <line x1={x + 82} y1={y} x2={x + 100} y2={y} strokeWidth={2} stroke="currentColor" />
    </g>
  ),
},


  vsource: {
  w: 80,
  h: 60,

  // 🔥 포트를 좌우로 재배치
  ports: [
    { id: "-", x: 0,  y: 30 },   // 왼쪽
    { id: "+", x: 80, y: 30 },   // 오른쪽
  ],

  draw: ({ x, y, rot }) => {
    const cx = x + 40; // 중심 X
    const cy = y + 30; // 중심 Y

    return (
      <g transform={`rotate(${rot},${cx},${cy})`}>
        
        {/* 왼쪽 선 */}
        <line
          x1={x}
          y1={cy}
          x2={cx - 20}
          y2={cy}
          strokeWidth={2}
          stroke="currentColor"
        />
        
        {/* 오른쪽 선 */}
        <line
          x1={cx + 20}
          y1={cy}
          x2={x + 80}
          y2={cy}
          strokeWidth={2}
          stroke="currentColor"
        />

        {/* 원 */}
        <circle
          cx={cx}
          cy={cy}
          r={18}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />

        {/* + 표시 (오른쪽) */}
        <text
          x={cx + 30}
          y={cy}
          fontSize="14"
          fill="currentColor"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${rot * -1},${cx + 30},${cy})`}
        >
          +
        </text>

        {/* - 표시 (왼쪽) */}
        <text
          x={cx - 30}
          y={cy}
          fontSize="14"
          fill="currentColor"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${rot * -1},${cx - 30},${cy})`}
        >
          -
        </text>

        {/* 내부 십자(기존 유지 가능) */}
        <line
          x1={cx - 6}
          y1={cy}
          x2={cx + 6}
          y2={cy}
          strokeWidth={2}
          stroke="currentColor"
        />
        <line
          x1={cx}
          y1={cy - 6}
          x2={cx}
          y2={cy + 6}
          strokeWidth={2}
          stroke="currentColor"
        />

      </g>
    );
  },
},

  ground: {
    w: 40,
    h: 50,
    ports: [{ id: "GND", x: 20, y: 0 }],
    draw: ({ x, y, rot }) => (
      <g transform={`rotate(${rot},${x + 20},${y + 25})`}>
        <line x1={x + 20} y1={y} x2={x + 20} y2={y + 15} strokeWidth={2} stroke="currentColor" />
        <line x1={x + 8} y1={y + 15} x2={x + 32} y2={y + 15} strokeWidth={2} stroke="currentColor" />
        <line x1={x + 10} y1={y + 21} x2={x + 30} y2={y + 21} strokeWidth={2} stroke="currentColor" />
        <line x1={x + 12} y1={y + 27} x2={x + 28} y2={y + 27} strokeWidth={2} stroke="currentColor" />
      </g>
    ),
  },
  diode: {
  w: 60,
  h: 20,
  ports: [
    { id: "A", x: 0, y: 0 },
    { id: "K", x: 60, y: 0 },
  ],
  draw: ({ x, y, rot }) => (
    <g transform={`rotate(${rot},${x + 30},${y + 10})`}>
      <line x1={x} y1={y} x2={x + 20} y2={y} strokeWidth={2} stroke="currentColor" />

      {/* 삼각형(애노드 방향) */}
      <polygon
        points={`${x + 20},${y - 10} ${x + 20},${y + 10} ${x + 35},${y}`}
        fill="none"
        strokeWidth={2}
        stroke="currentColor"
      />

      {/* 캐소드 선 */}
      <line x1={x + 35} y1={y - 10} x2={x + 35} y2={y + 10} strokeWidth={2} stroke="currentColor" />

      <line x1={x + 35} y1={y} x2={x + 60} y2={y} strokeWidth={2} stroke="currentColor" />
    </g>
  ),
},
led: {
  w: 60,
  h: 20,
  ports: [
    { id: "A", x: 0, y: 0 },
    { id: "K", x: 60, y: 0 },
  ],
  draw: ({ x, y, rot }) => (
    <g transform={`rotate(${rot},${x + 30},${y + 10})`}>
      {/* LED 기본 다이오드 모양 */}
      <line x1={x} y1={y} x2={x + 20} y2={y} strokeWidth={2} stroke="currentColor" />

      <polygon
        points={`${x + 20},${y - 10} ${x + 20},${y + 10} ${x + 35},${y}`}
        fill="none"
        strokeWidth={2}
        stroke="currentColor"
      />

      <line x1={x + 35} y1={y - 10} x2={x + 35} y2={y + 10} strokeWidth={2} stroke="currentColor" />
      <line x1={x + 35} y1={y} x2={x + 60} y2={y} strokeWidth={2} stroke="currentColor" />

      {/* 빛 화살표 */}
      <polyline
        points={`${x + 45},${y - 5} ${x + 55},${y - 15}`}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
      />
      <polyline
        points={`${x + 42},${y - 2} ${x + 52},${y - 12}`}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
      />
    </g>
  ),
},
npn: {
  w: 60,
  h: 60,
  ports: [
    { id: "B", x: 0, y: 30 },     // Base
    { id: "C", x: 60, y: 10 },    // Collector
    { id: "E", x: 60, y: 50 },    // Emitter
  ],
  draw: ({ x, y, rot }) => {
    const cx = x + 30;
    const cy = y + 30;
    return (
      <g transform={`rotate(${rot},${cx},${cy})`}>
        
        {/* Base */}
        <line x1={x} y1={y + 30} x2={x + 20} y2={y + 30} strokeWidth={2} stroke="currentColor" />

        {/* 본체 원 */}
        <circle cx={cx} cy={cy} r={15} fill="none" strokeWidth={2} stroke="currentColor" />

        {/* Collector */}
        <line x1={cx + 15} y1={cy - 10} x2={x + 60} y2={y + 10} strokeWidth={2} stroke="currentColor" />

        {/* Emitter (NPN 화살표) */}
        <line x1={cx + 15} y1={cy + 10} x2={x + 60} y2={y + 50} strokeWidth={2} stroke="currentColor" />
        <polyline
          points={`${x + 52},${y + 43} ${x + 60},${y + 50} ${x + 52},${y + 55}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
        />

      </g>
    );
  },
},
pnp: {
  w: 60,
  h: 60,
  ports: [
    { id: "B", x: 0, y: 30 },
    { id: "C", x: 60, y: 10 },
    { id: "E", x: 60, y: 50 },
  ],
  draw: ({ x, y, rot }) => {
    const cx = x + 30;
    const cy = y + 30;
    return (
      <g transform={`rotate(${rot},${cx},${cy})`}>
        
        {/* Base */}
        <line x1={x} y1={y + 30} x2={x + 20} y2={y + 30} strokeWidth={2} stroke="currentColor" />

        {/* 본체 원 */}
        <circle cx={cx} cy={cy} r={15} fill="none" strokeWidth={2} stroke="currentColor" />

        {/* Collector */}
        <line x1={cx + 15} y1={cy - 10} x2={x + 60} y2={y + 10} strokeWidth={2} stroke="currentColor" />

        {/* Emitter (PNP에서 화살표 반대) */}
        <line x1={cx + 15} y1={cy + 10} x2={x + 60} y2={y + 50} strokeWidth={2} stroke="currentColor" />
        <polyline
          points={`${x + 60},${y + 50} ${x + 52},${y + 43} ${x + 60},${y + 37}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
        />

      </g>
    );
  },
},
nmos: {
  w: 60,
  h: 60,
  ports: [
    { id: "G", x: 0, y: 30 },
    { id: "D", x: 60, y: 10 },
    { id: "S", x: 60, y: 50 },
  ],
  draw: ({ x, y, rot }) => (
    <g transform={`rotate(${rot},${x + 30},${y + 30})`}>
      {/* Gate */}
      <line x1={x} y1={y + 30} x2={x + 20} y2={y + 30} strokeWidth={2} stroke="currentColor" />

      {/* Drain */}
      <line x1={x + 30} y1={y + 10} x2={x + 60} y2={y + 10} strokeWidth={2} stroke="currentColor" />

      {/* Source */}
      <line x1={x + 30} y1={y + 50} x2={x + 60} y2={y + 50} strokeWidth={2} stroke="currentColor" />

      {/* 바디 라인 */}
      <line x1={x + 30} y1={y + 10} x2={x + 30} y2={y + 50} strokeWidth={2} stroke="currentColor" />
    </g>
  ),
},
pmos: {
  w: 60,
  h: 60,
  ports: [
    { id: "G", x: 0, y: 30 },
    { id: "D", x: 60, y: 10 },
    { id: "S", x: 60, y: 50 },
  ],
  draw: ({ x, y, rot }) => (
    <g transform={`rotate(${rot},${x + 30},${y + 30})`}>
      {/* Gate */}
      <line x1={x} y1={y + 30} x2={x + 20} y2={y + 30} strokeWidth={2} stroke="currentColor" />

      {/* Drain */}
      <line x1={x + 30} y1={y + 10} x2={x + 60} y2={y + 10} strokeWidth={2} stroke="currentColor" />

      {/* Source */}
      <line x1={x + 30} y1={y + 50} x2={x + 60} y2={y + 50} strokeWidth={2} stroke="currentColor" />

      {/* 바디 라인 (PMOS 구분용) */}
      <circle cx={x + 25} cy={y + 30} r={4} fill="currentColor" />
    </g>
  ),
},



};

function rotatePointAroundCenter(rel, def, rotDeg) {
  const rad = (rotDeg * Math.PI) / 180;
  const cx = def.w / 2,
    cy = def.h / 2;
  const dx = rel.x - cx,
    dy = rel.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function alignOriginForPorts(type, rot, x, y) {
  const def = DRAW_LIB[type];
  const first = def.ports[0];
  const pr = rotatePointAroundCenter({ x: first.x, y: first.y }, def, rot);
  const wantX = snap(x + pr.x);
  const wantY = snap(y + pr.y);
  const dx = wantX - (x + pr.x);
  const dy = wantY - (y + pr.y);
  return { x: x + dx, y: y + dy };
}




function computeElementBBox(el) {
  const def = DRAW_LIB[el.type];
  if (!def) return null;

  const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  tempSvg.setAttribute("width", 0);
  tempSvg.setAttribute("height", 0);
  tempSvg.style.position = "absolute";
  tempSvg.style.left = "-9999px";

  document.body.appendChild(tempSvg);

  const reactNode = def.draw(el);
  tempSvg.innerHTML = `<g>${ReactDOMServer.renderToStaticMarkup(reactNode)}</g>`;
  const realG = tempSvg.firstChild;
  const box = realG.getBBox();

  document.body.removeChild(tempSvg);

  return {
    x: box.x,
    y: box.y,
    w: box.width,
    h: box.height,
  };
}

// ----------------------
// 텍스트 기반 tran 데이터 파서
// ----------------------
function parseTranData(output) {
  if (!output) return [];

  const rawLines = output.split("\n");

  // "Index ..." 헤더 줄 찾기
  const headerIdx = rawLines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("index")
  );
  if (headerIdx === -1) return [];

  const headerLine = rawLines[headerIdx].trim();
  let headers = headerLine.split(/\s+/);

  // === 중복 컬럼 rename (time, time2 처럼) ===
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
    if (!line) continue;

    // 다음 섹션 시작 같은 라인이면 종료
    if (line.startsWith("===")) break;

    // 구분선(----)은 건너뜀
    if (/^-{3,}$/.test(line)) continue;

    // 숫자로 시작하지 않으면 데이터가 아니니까 건너뜀
    if (!/^\d+/.test(line)) continue;

    const parts = line.split(/\s+/);
    const row = {};

    headers.forEach((h, idx) => {
      if (h === "index") return; // index 컬럼은 버림

      const key = h.replace(/[^\w]/g, "_");
      const rawVal = parts[idx];
      const num = rawVal !== undefined ? parseFloat(rawVal) : NaN;

      row[key] = Number.isNaN(num) ? 0 : num;
    });

    data.push(row);
  }

  return data;
}





// ----------------------
// 그래프 컴포넌트 (simOutput 기반)
// ----------------------
function SimulationGraph({ simOutput }) {
  const [data, setData] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);

  useEffect(() => {
    if (!simOutput) {
      setData([]);
      setSelectedKeys([]);
      return;
    }

    const parsed = parseTranData(simOutput);
    setData(parsed);

    if (parsed.length > 0) {
      const keys = Object.keys(parsed[0]).filter((k) => k.toLowerCase() !== "time");
      setSelectedKeys(keys.slice(0, 2)); // 기본 두 개만 표시
    } else {
      setSelectedKeys([]);
    }
  }, [simOutput]);

  if (!data.length) {
    return (
      <div style={{ color: "#999", fontSize: 13 }}>
        그래프를 표시할 시뮬레이션 데이터가 없습니다.  
        (.tran + .print tran 결과가 텍스트에 나와야 합니다.)
      </div>
    );
  }

  const allKeys = Object.keys(data[0]).filter(
  (k) => k.toLowerCase() !== "time" && k.toLowerCase() !== "time2");
  const colors = ["#007bff", "#ff4081", "#4caf50", "#ff9800", "#9c27b0", "#2196f3"];

  return (
    <div style={{ width: "100%", maxWidth: 1200 }}>
      <h3 style={{ marginBottom: 10 }}>📈 Transient 파형 그래프 (텍스트 파싱)</h3>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 15 }}>
        {allKeys.map((key) => (
          <label key={key} style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={selectedKeys.includes(key)}
              onChange={() =>
                setSelectedKeys((prev) =>
                  prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                )
              }
            />{" "}
            {key}
          </label>
        ))}
      </div>

      <LineChart width={1100} height={380} data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="time"
          label={{ value: "Time (s)", position: "insideBottomRight", offset: -5 }}
        />
        <YAxis />
        <Tooltip />
        <Legend />
        {selectedKeys.map((key, idx) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={colors[idx % colors.length]}
            dot={false}
          />
        ))}
      </LineChart>
    </div>
  );
}

// ----------------------
// 메인 App
// ----------------------
export default function App() {
  const [elements, setElements] = useState([
  { id: uid("R"), type: "resistor", x: 200, y: 160, rot: 0, value: "10k" },
  { id: uid("C"), type: "capacitor", x: 420, y: 160, rot: 0, value: "100u" },
  { id: uid("L"), type: "inductor", x: 640, y: 160, rot: 0, value: "10m" },

  {
    id: uid("V"),
    type: "vsource",
    ...alignOriginForPorts("vsource", 0, 200, 360),
    rot: 0,
    waveType: "DC",         // ⬅ 새로 추가
    dc: "5",                // DC 값
    acMag: "",
    acPhase: "",
    sin: { offset: "0", amp: "1", freq: "60", delay: "0", theta: "0", phase: "0" },
    pulse: { v1: "0", v2: "5", delay: "0", tr: "1u", tf: "1u", pw: "1m", per: "2m" },
    exp: { v1: "0", v2: "5", td1: "0", tau1: "1m", td2: "0", tau2: "1m" },
    pwl: "0 0, 1m 5, 2m 0",
  },

  { id: uid("G"), type: "ground", x: 640, y: 360, rot: 0, value: "" },
]);


  const [simOutput, setSimOutput] = useState(""); // 텍스트 출력 (이걸로 그래프 그림)
  const canvasRef = useRef(null);
  const [wires, setWires] = useState([]);
  const [drag, setDrag] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [selected, setSelected] = useState([]);
  const [mousePos, setMousePos] = useState(null);
  const [box, setBox] = useState(null);
  const [boxStart, setBoxStart] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [draggingType, setDraggingType] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [circuit, setCircuit] = useState(null);
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 800 });
  const [routingMode, setRoutingMode] = useState(null);
  const [startPt, setStartPt] = useState(null);

  const [useOp, setUseOp] = useState(true);
  const [useTran, setUseTran] = useState(false);
  const [useAc, setUseAc] = useState(false);

  const [tranParams, setTranParams] = useState({
    step: "0",
    stop: "10m",
    start: "0",
    maxstep: "100u",
  });
  const [acParams, setAcParams] = useState({
    sweep: "dec",
    points: "10",
    start: "1",
    stop: "1e6",
  });

  const svgRef = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef(null);

  const bboxCache = useRef(new Map());

// 1단계: 회로를 그래프로 전환
function buildGraph(components, connections) {
  const graph = {};

  // 노드 생성
  components.forEach(c => {
    graph[c.id] = {
      id: c.id,
      neighbors: [],
    };
  });

  // 간선 생성
  connections.forEach(conn => {
    const [fromId] = conn.from.split(".");
    const [toId] = conn.to.split(".");

    if (!graph[fromId] || !graph[toId]) return;

    graph[fromId].neighbors.push(toId);
    graph[toId].neighbors.push(fromId);
  });

  return graph;
}

// 4단계: 레벨 기반 자동 배치(KiCad 스타일)
function applyAutoLayout(components, connections) {
  const graph = buildGraph(components, connections);
  const rootId = findRoot(components);
  const levels = computeLevels(graph, rootId);

  // 레벨별 묶기
  const levelGroups = {};
  Object.entries(levels).forEach(([id, lvl]) => {
    if (!levelGroups[lvl]) levelGroups[lvl] = [];
    levelGroups[lvl].push(id);
  });

  // 좌표 계산
  const H_GAP = 160; // 레벨 간 좌우 간격
  const V_GAP = 120; // 세로 정렬 간격
  const START_X = 200; // 루트 시작 X

  const newPositions = {};

  Object.entries(levelGroups).forEach(([lvlStr, ids]) => {
    const lvl = parseInt(lvlStr);

    const x = START_X + lvl * H_GAP;

    ids.forEach((id, idx) => {
      const y = 160 + idx * V_GAP;
      newPositions[id] = { x, y };
    });
  });

  return newPositions; // { C1:{x:350,y:160}, R1:{x:350,y:280}, ... }
}


function findRoot(components) {
  // 전원(Vsource)이 있으면 무조건 루트
  const v = components.find(c => c.type === "vsource");
  if (v) return v.id;

  // 없으면 첫 번째 소자
  return components[0]?.id;
}

// 3단계: BFS로 각 컴포넌트 레벨 계산
function computeLevels(graph, rootId) {
  const level = {};
  const visited = new Set();
  const queue = [];

  // 루트부터 시작
  level[rootId] = 0;
  visited.add(rootId);
  queue.push(rootId);

  while (queue.length > 0) {
    const cur = queue.shift();
    const curLevel = level[cur];

    graph[cur].neighbors.forEach((nb) => {
      if (!visited.has(nb)) {
        visited.add(nb);
        level[nb] = curLevel + 1;
        queue.push(nb);
      }
    });
  }

  return level; // { C1:1, R1:1, L1:2, ... }
}


  useEffect(() => {
    function resize() {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

// =========================================================
// ⭐ GPT JSON → elements[], wires[] 자동 변환 (안전 필터 포함)
// =========================================================
useEffect(() => {
  if (!circuit) return;

  try {
    const { components = [], connections = [] } = circuit;

    // -------------------------
    // 1) 안전한 소자 필터링
    // -------------------------
   const safeComponents = components
  .map((c) => ({
    ...c,
    type: (c.type || "").toLowerCase(),   // 🔥 모든 타입 소문자로 강제 변환
  }))
  .filter((c) => !!DRAW_LIB[c.type]); 

    // -------------------------
    // 2) 안전한 연결 필터링
    // -------------------------
    const safeConnections = connections.filter((conn) => {
      if (!conn.from || !conn.to) return false;

      const [cidA, portA] = conn.from.split(".");
      const compA = safeComponents.find((c) => c.id === cidA);
      if (!compA) return false;

      const [cidB, portB] = conn.to.split(".");
      const compB = safeComponents.find((c) => c.id === cidB);
      if (!compB) return false;

      return true;
    });

    // -------------------------
    // ⭐ 3) element 변환
    // -------------------------
    let newElements = safeComponents.map((c) => {
      const base = {
        id: c.id,
        type: c.type,
        x: snap(c.x || 200),
        y: snap(c.y || 200),
        rot: c.rot || 0,
        value: c.value || "",
      };

      if (c.type === "vsource") {
        return {
          ...base,
          waveType: c.waveType || "DC",
          dc: c.dc || "5",
          acMag: c.acMag || "",
          acPhase: c.acPhase || "",
          sin:
            c.sin || {
              offset: "0",
              amp: "1",
              freq: "60",
              delay: "0",
              theta: "0",
              phase: "0",
            },
          pulse:
            c.pulse || {
              v1: "0",
              v2: "5",
              delay: "0",
              tr: "1u",
              tf: "1u",
              pw: "1m",
              per: "2m",
            },
          exp:
            c.exp || {
              v1: "0",
              v2: "5",
              td1: "0",
              tau1: "1m",
              td2: "0",
              tau2: "1m",
            },
          pwl: c.pwl || "0 0, 1m 5, 2m 0",
        };
      }

      if (c.type === "ground") {
        return { ...base, value: "" };
      }

      return base;
    });

    // -------------------------
    // ⭐ 4) wire 변환 (여기 수정!) 
    // -------------------------
    const newWires = safeConnections.map((conn, idx) => {
      const [elA, portA] = conn.from.split(".");
      const [elB, portB] = conn.to.split(".");

      return {
        id: uid("W"),   
        a: { el: elA, portId: portA },
        b: { el: elB, portId: portB },
      };
    });

    // -------------------------
    // 적용
    // -------------------------
    const auto = applyAutoLayout(newElements, safeConnections);
    newElements = newElements.map(el =>
  auto[el.id] ? { ...el, x: auto[el.id].x, y: auto[el.id].y } : el
);
    setElements(newElements);
    setWires(newWires);
    setSelected([]);
    setInspector(null);

  } catch (err) {
    console.error("GPT 회로 자동 배치 오류:", err);
  }
}, [circuit]);




  function getBBox(el) {
    const key = `${el.id}_${el.rot}_${el.x}_${el.y}`;
    if (bboxCache.current.has(key)) return bboxCache.current.get(key);

    const box = computeElementBBox(el);
    bboxCache.current.set(key, box);
    return box;
  }

  function stableOrthogonalPath(a, b, mode) {
    if (!mode) return bestOrthogonal(a, b);

    if (mode === "h") {
      return [a.x, a.y, b.x, a.y, b.x, b.y];
    }
    if (mode === "v") {
      return [a.x, a.y, a.x, b.y, b.x, b.y];
    }
    return bestOrthogonal(a, b);
  }

  function portAbsolutePosition(el, port) {
    const def = DRAW_LIB[el.type];
    const rad = (el.rot * Math.PI) / 180;
    const cx = el.x + def.w / 2;
    const cy = el.y + def.h / 2;

    const dx = port.x - def.w / 2;
    const dy = port.y - def.h / 2;

    return {
      x: snap(cx + dx * Math.cos(rad) - dy * Math.sin(rad)),
      y: snap(cy + dx * Math.sin(rad) + dy * Math.cos(rad)),
    };
  }

  function getRotatedVoltagePolarity(el) {
    const def = DRAW_LIB[el.type];
    const plusPort = def.ports.find((p) => p.id === "+");
    const minusPort = def.ports.find((p) => p.id === "-");
    const pPlus = portAbsolutePosition(el, plusPort);
    const pMinus = portAbsolutePosition(el, minusPort);

    const rot = ((el.rot % 360) + 360) % 360;

    if (rot === 0) {
      return pPlus.y > pMinus.y ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    }
    if (rot === 90) {
      return pPlus.x > pMinus.x ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    }
    if (rot === 180) {
      return pPlus.y < pMinus.y ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    }
    if (rot === 270) {
      return pPlus.x < pMinus.x ? { vp: "+", vn: "-" } : { vp: "-", vn: "+" };
    }
    return { vp: "+", vn: "-" };
  }

  const handleWheel = useCallback(
    (e) => {
      if (!e.shiftKey) return;
      e.preventDefault();

      const zoomIntensity = 0.0015;
      const delta = -e.deltaY;

      const newZoom = Math.max(0.2, Math.min(4, zoom + delta * zoomIntensity));
      if (newZoom === zoom) return;

      const wrapper = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - wrapper.left;
      const my = e.clientY - wrapper.top;

      const ratio = newZoom / zoom;

      setPan({
        x: mx - (mx - pan.x) * ratio,
        y: my - (my - pan.y) * ratio,
      });

      setZoom(newZoom);
    },
    [zoom, pan]
  );

  const handleSvgMouseDown = (e) => {
    setInspector(null);
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    onMouseDownBoard(e);
  };

  const handleSvgMouseMove = (e) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
      return;
    }
    onMouseMove(e);
  };

  const handleSvgMouseUp = (e) => {
    setIsPanning(false);
    onMouseUp(e);
  };

useEffect(() => {
  const wrapper = canvasRef.current;
  if (!wrapper) return;

  const wheelHandler = (e) => {
    // Shift 누르고 돌릴 때만 줌
    if (e.shiftKey) {
      e.preventDefault();
      handleWheel(e);
    }
  };

  wrapper.addEventListener("wheel", wheelHandler, { passive: false });

  return () => {
    wrapper.removeEventListener("wheel", wheelHandler);
  };
}, [handleWheel]);


  const addWire = (a, b) => {
    const exists = wires.some(
      (w) =>
        (w.a.el === a.el &&
          w.a.portId === a.portId &&
          w.b.el === b.el &&
          w.b.portId === b.portId) ||
        (w.b.el === a.el &&
          w.b.portId === a.portId &&
          w.a.el === b.el &&
          w.a.portId === b.portId)
    );
    if (exists) return;

    setWires((ws) => [...ws, { id: uid("W"), a, b }]);
  };

  const onMouseDownPart = (e, el) => {
    e.stopPropagation();
    const pt = clientToSvg(e, svgRef.current, pan, zoom);

    if (!selected.includes(el.id)) {
      if (e.shiftKey) {
        setSelected((prev) =>
          prev.includes(el.id) ? prev.filter((x) => x !== el.id) : [...prev, el.id]
        );
      } else setSelected([el.id]);
    }
    const moveIds = selected.includes(el.id) ? [...selected] : [el.id];
    const startPositions = moveIds.map((id) => {
      const found = elements.find((it) => it.id === id);
      return { id, x: found.x, y: found.y, rot: found.rot, type: found.type };
    });
    setDrag({ ids: moveIds, startMouse: pt, startPositions });
    setInspector({
      id: el.id,
      x: el.x,
      y: el.y,
    });
    if (e.shiftKey) return;
  };

  const onMouseDownBoard = (e) => {
    const pt = clientToSvg(e, svgRef.current, pan, zoom);
    setBoxStart(pt);
    setBox({
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
    });
  };

  const onMouseMove = (e) => {
    const pt = clientToSvg(e, svgRef.current, pan, zoom);

    if (connectFrom) {
      setMousePos({ x: pt.x, y: pt.y });

      if (!routingMode && startPt) {
        const dx = Math.abs(pt.x - startPt.x);
        const dy = Math.abs(pt.y - startPt.y);

        if (dx > 10 || dy > 10) {
          setRoutingMode(dx > dy ? "h" : "v");
        }
      }
    }

    if (boxStart) {
      setMousePos({ x: pt.x, y: pt.y, event: e });
      setBox({
        x1: boxStart.x,
        y1: boxStart.y,
        x2: pt.x,
        y2: pt.y,
      });
      return;
    }

    if (!drag) return;

    const dx = snap(pt.x - drag.startMouse.x);
    const dy = snap(pt.y - drag.startMouse.y);

    let newPos = null;
    setElements((els) =>
      els.map((it) => {
        const start = drag.startPositions.find((s) => s.id === it.id);
        if (!start) return it;

        const rawX = start.x + dx;
        const rawY = start.y + dy;
        const aligned = alignOriginForPorts(start.type, start.rot, rawX, rawY);

        if (inspector && inspector.id === it.id) {
          newPos = { x: aligned.x, y: aligned.y };
        }

        return { ...it, x: aligned.x, y: aligned.y };
      })
    );

    if (inspector && newPos) {
      setInspector((prev) => (prev ? { ...prev, x: newPos.x, y: newPos.y } : null));
    }
  };

  const onMouseUp = () => {
    if (box) {
      const x1 = Math.min(box.x1, box.x2);
      const y1 = Math.min(box.y1, box.y2);
      const x2 = Math.max(box.x1, box.x2);
      const y2 = Math.max(box.y1, box.y2);

      const ids = elements
        .filter((el) => el.x >= x1 && el.x <= x2 && el.y >= y1 && el.y <= y2)
        .map((el) => el.id);

      setSelected(ids);
      setBox(null);
      setBoxStart(null);
      return;
    }
    setDrag(null);
  };

  const handleKey = (e) => {
    if (e.key === "Escape") {
      setInspector(null);
      if (connectFrom) {
        setConnectFrom(null);
        setMousePos(null);
        return;
      }
      setWires((ws) =>
        ws.filter((w) => !selected.includes(w.a.el) && !selected.includes(w.b.el))
      );
      return;
    }
    if (e.key === "Delete") {
      setElements((els) => els.filter((it) => !selected.includes(it.id)));
      setWires((ws) =>
        ws.filter((w) => !selected.includes(w.a.el) && !selected.includes(w.b.el))
      );
      setSelected([]);
      return;
    }
    if (e.key === "r" || e.key === "R") {
      setElements((els) =>
        els.map((it) => {
          if (!selected.includes(it.id)) return it;
          const nextRot = (it.rot + 90) % 360;
          const aligned = alignOriginForPorts(it.type, nextRot, it.x, it.y);
          return { ...it, rot: nextRot, x: aligned.x, y: aligned.y };
        })
      );
    }
  };

  const getEl = useCallback(
    (id) => elements.find((e) => e.id === id),
    [elements]
  );

  const startPosOf = (wireEnd) => {
    const el = getEl(wireEnd.el);
    if (!el) return { x: 0, y: 0 };

    const def = DRAW_LIB[el.type];
    const port = def.ports.find((p) => p.id === wireEnd.portId);
    return portAbsolutePosition(el, port);
  };

  const handlePortMouseDown = (e, elId, portId) => {
    e.stopPropagation();

    if (connectFrom && connectFrom.elId === elId && connectFrom.portId === portId) {
      setConnectFrom(null);
      setMousePos(null);
      setRoutingMode(null);
      setStartPt(null);
      return;
    }

    if (!connectFrom) {
      const a = startPosOf({ el: elId, portId });
      setStartPt(a);
      setRoutingMode(null);
      setConnectFrom({ elId, portId });
      return;
    }

    addWire(
      { el: connectFrom.elId, portId: connectFrom.portId },
      { el: elId, portId }
    );
    setConnectFrom(null);
    setMousePos(null);
    setRoutingMode(null);
    setStartPt(null);
  };

  const handlePortMouseUp = (e, elId, portId) => {
    e.stopPropagation();
    if (!connectFrom) return;
    if (connectFrom.elId === elId && connectFrom.portId === portId) return;

    addWire(
      { el: connectFrom.elId, portId: connectFrom.portId },
      { el: elId, portId }
    );

    setRoutingMode(null);
    setStartPt(null);
    setConnectFrom(null);
    setMousePos(null);
  };

  const gridLines = useMemo(() => {
    const lines = [];

    const vbX = -pan.x / zoom;
    const vbY = -pan.y / zoom;
    const vbW = viewportSize.width / zoom;
    const vbH = viewportSize.height / zoom;

    const PAD = GRID * 200;

    const startX = Math.floor((vbX - PAD) / GRID) * GRID;
    const endX = Math.ceil((vbX + vbW + PAD) / GRID) * GRID;

    const startY = Math.floor((vbY - PAD) / GRID) * GRID;
    const endY = Math.ceil((vbY + vbH + PAD) / GRID) * GRID;

    for (let x = startX; x <= endX; x += GRID) {
  lines.push(
    <line
      key={`gx-${startX}-${endX}-${x}`}
      x1={x}
      y1={startY}
      x2={x}
      y2={endY}
      stroke="#f0f0f0"
    />
  );
}

for (let y = startY; y <= endY; y += GRID) {
  lines.push(
    <line
      key={`gy-${startY}-${endY}-${y}`}
      x1={startX}
      y1={y}
      x2={endX}
      y2={y}
      stroke="#f0f0f0"
    />
  );
}

    return lines;
  }, [pan, zoom, viewportSize]);

  const buildDirective = () => {
    const lines = [];
    if (useOp) lines.push(".op");
    if (useTran) {
      const { step, stop, start, maxstep } = tranParams;
      const safeStep = step && parseFloat(step) > 0 ? step : "1u";
      const parts = [".tran", safeStep, stop || "10m", start || "0", maxstep || ""].filter(
        (s) => `${s}`.trim() !== ""
      );
      lines.push(parts.join(" "));
    }
    if (useAc) {
      const { sweep, points, start, stop } = acParams;
      const parts = [".ac", sweep, points, start, stop].filter(
        (s) => `${s}`.trim() !== ""
      );
      lines.push(parts.join(" "));
    }
    return lines.join("\n");
  };

  function generateNetlist() {
  // ---- DSU (Union-Find) 기반 노드 계산 ----
  const portKeys = [];
  elements.forEach((el) => {
    const def =DRAW_LIB[el.type];
    def.ports.forEach((p) => portKeys.push(`${el.id}.${p.id}`));
  });

  const parent = new Map();
  const find = (x) => {
    if (parent.get(x) === x) return x;
    parent.set(x, find(parent.get(x)));
    return parent.get(x);
  };
  const union = (a, b) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  portKeys.forEach((k) => parent.set(k, k));

  wires.forEach((w) => {
    const a = `${w.a.el}.${w.a.portId}`;
    const b = `${w.b.el}.${w.b.portId}`;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    union(a, b);
  });

  // ---- GROUND ----
  const GROUND_ANCHOR = "0";
  parent.set(GROUND_ANCHOR, GROUND_ANCHOR);
  elements.forEach((el) => {
    if (el.type === "ground") {
      const pk = `${el.id}.GND`;
      if (!parent.has(pk)) parent.set(pk, pk);
      union(pk, GROUND_ANCHOR);
    }
  });

  const rootHasGnd = new Map();
  const roots = new Set();
  Array.from(parent.keys()).forEach((k) => roots.add(find(k)));
  roots.forEach((r) => rootHasGnd.set(r, false));
  Array.from(parent.keys()).forEach((k) => {
    if (find(k) === find(GROUND_ANCHOR)) rootHasGnd.set(find(k), true);
  });

  const nodeNameByRoot = new Map();
  let nodeSeq = 1;
  roots.forEach((r) => {
    if (r === GROUND_ANCHOR || rootHasGnd.get(r)) {
      nodeNameByRoot.set(r, "0");
    } else {
      nodeNameByRoot.set(r, `N${nodeSeq++}`);
    }
  });

  const nodeOf = (portKey) => {
    if (!parent.has(portKey)) parent.set(portKey, portKey);
    const r = find(portKey);
    if (!nodeNameByRoot.has(r)) nodeNameByRoot.set(r, `N${nodeSeq++}`);
    return nodeNameByRoot.get(r);
  };

  // ---- RefDes 자동번호 ----
  const refMap = new Map();
  const counters = {
    resistor: 1,
    capacitor: 1,
    inductor: 1,
    vsource: 1,
    ground: 1,
  };
  const refOf = (el) => {
    if (refMap.has(el.id)) return refMap.get(el.id);
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
    const prefix = map[el.type] || "X";
    const n = counters[el.type] ?? 1;
    counters[el.type] = n + 1;
    const ref = `${prefix}${n}`;
    refMap.set(el.id, ref);
    return ref;
  };

  // ---- Netlist 생성 시작 ----
  const lines = [];
  lines.push("* ELECHUB CIRCUIT NETLIST");

  // ---- 소자 라인 출력 ----
  elements.forEach((el) => {
    const def = DRAW_LIB[el.type];
    if (el.type === "ground") return;

    const getNode = (portId) => nodeOf(`${el.id}.${portId}`);

    if (el.type === "resistor") {
      const ref = refOf(el);
      const a = getNode("A");
      const b = getNode("B");
      const val = (el.value ?? "").replace(/[^\d.eE+-kmµunpKMUNP]/g, "") || "1k";
      lines.push(`${ref} ${a} ${b} ${val}`);
    } else if (el.type === "capacitor") {
      const ref = refOf(el);
      const a = getNode("A");
      const b = getNode("B");
      const val = (el.value ?? "").replace(/[^\d.eE+-kmµunpKMUNP]/g, "") || "1u";
      lines.push(`${ref} ${a} ${b} ${val}`);
    } else if (el.type === "inductor") {
      const ref = refOf(el);
      const a = getNode("A");
      const b = getNode("B");
      const val = (el.value ?? "").replace(/[^\d.eE+-kmµunpKMUNP]/g, "") || "10m";
      lines.push(`${ref} ${a} ${b} ${val}`);
    } else if (el.type === "vsource") {
  const ref = refOf(el);
  const { vp: vpPortId, vn: vnPortId } = getRotatedVoltagePolarity(el);
  const vp = getNode(vpPortId);
  const vn = getNode(vnPortId);

  let line = `${ref} ${vp} ${vn}`;

  switch (el.waveType) {
    case "DC":
      line += ` DC ${el.dc || 0}`;
      break;

    case "AC":
      line += ` AC ${el.acMag || 1} ${el.acPhase || 0}`;
      break;

    case "SIN":
      const s = el.sin;
      line += ` SIN(${s.offset} ${s.amp} ${s.freq} ${s.delay} ${s.theta} ${s.phase})`;
      break;

    case "PULSE":
      const p = el.pulse;
      line += ` PULSE(${p.v1} ${p.v2} ${p.delay} ${p.tr} ${p.tf} ${p.pw} ${p.per})`;
      break;

    case "EXP":
      const e = el.exp;
      line += ` EXP(${e.v1} ${e.v2} ${e.td1} ${e.tau1} ${e.td2} ${e.tau2})`;
      break;

    case "PWL":
      line += ` PWL(${el.pwl})`;
      break;
       default:
    // 혹시값이 없으면 DC 0으로 처리
    line += ` DC 0`;
    break;
  }

  lines.push(line);
}



  });

  // ---- 🔥 핵심: .control 블록 추가 ----
const directives = `
.control
set filetype=ascii
${useOp ? "op" : ""}
${useTran ? `tran ${tranParams.step} ${tranParams.stop} ${tranParams.start} ${tranParams.maxstep}` : ""}
${useAc ? `ac ${acParams.sweep} ${acParams.points} ${acParams.start} ${acParams.stop}` : ""}
${useTran ? "print tran all" : ""}
.endc
`;

  lines.push(directives);

  // ---- 🔥 기존 .op .tran .ac .save .print .measure 전부 제거됨 ----

  // ---- Netlist 종료 ----
  lines.push(".end\n");

  return lines.join("\n");
}


  async function runSimulation() {
    setSimOutput("⏳ 시뮬레이션 실행 중...");

    try {
      const NgSpiceModule = await loadNgspice();
      const netlist = generateNetlist();
      let output = "";

      const ignorePatterns = [
        "/proc/meminfo",
        "spinit",
        "Warning: can't find",
        "Internal Error",
        "not found",
        "compatibility mode",
        "DRAM",
        "Maximum ngspice",
        "Shared ngspice",
        "Text (code)",
        "Stack =",
        "Library pages",
        "program size",
        "fopen",
      ];

      const ngspice = await NgSpiceModule({
        print: (txt) => {
          output += txt + "\n";
        },
        printErr: (txt) => {
          if (!ignorePatterns.some((p) => txt.includes(p))) {
            output += "[ERR] " + txt + "\n";
          }
        },
        stdin: () => 0,
        noInitialRun: true,
      });

      if (!ngspice.FS.analyzePath("/working").exists) {
        ngspice.FS.mkdir("/working");
      }
      ngspice.FS.mount(ngspice.FS.filesystems.MEMFS, {}, "/working");
      ngspice.FS.chdir("/working");

      ngspice.FS.writeFile("tmp.cir", netlist);
      console.log("✅ tmp.cir content:\n", netlist);

      ngspice.callMain(["-b", "tmp.cir"]);

      await new Promise((r) => setTimeout(r, 500));

      const cleanLines = output
        .split("\n")
        .map((l) => l.trimEnd())
        .filter(
          (l) =>
            l &&
            !ignorePatterns.some((p) => l.includes(p)) &&
            !l.startsWith("Note: No compatibility mode selected!")
        );

      const formatted = [];
      let section = "";

      for (const line of cleanLines) {
        const lower = line.toLowerCase();

        if (
          lower.includes("operating point information") ||
          lower.includes("initial transient solution")
        ) {
          section = "Operating Point / Transient";
          formatted.push(`\n=== 🔹 ${section} ===`);
        } else if (lower.startsWith("index") && lower.includes("time")) {
          section = "Transient Data Table";
          formatted.push(`\n=== 📈 ${section} ===`);
        } else if (lower.includes("fourier")) {
          section = "Fourier Analysis";
          formatted.push(`\n=== 🎵 ${section} ===`);
        } else if (lower.includes("measure") || lower.includes("avg(") || lower.includes("rms(")) {
          section = "Measurement Results";
          formatted.push(`\n=== 📊 ${section} ===`);
        } else if (lower.includes("ac analysis") || lower.includes("frequency")) {
          section = "AC Sweep Analysis";
          formatted.push(`\n=== 📡 ${section} ===`);
        }

        formatted.push(line);
      }

      const formattedOutput = formatted
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\[ERR\]/g, "⚠️ Error:");

      setSimOutput(formattedOutput || "✅ 시뮬레이션 완료 (출력 없음)");
    } catch (err) {
      console.error(err);
      setSimOutput("❌ 시뮬레이션 오류: " + err.message);
    }
  }

  function handleExportNetlist() {
    const text = generateNetlist();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "elechub_circuit.net";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div
        style={{
          height: "auto",
          margin: "20px auto",
          width: "1340px",
          maxWidth: "1340px",
          borderRadius: "5px",
          overflow: "hidden",
          boxShadow: "2px 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        <ChatPanel onCircuitGenerated={setCircuit} />
      </div>

      <div
        tabIndex={0}
        onKeyDown={handleKey}
        style={{
          width: "100%",
          height: "900px",
          display: "flex",
          justifyContent: "center",
          background: "#ffffffff",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "220px 1fr",
            width: "1340px",
            maxWidth: "1340px",
            padding: "0 0 20px 0",
            height: "930px",
            border: "1px solid #eee",
            borderRadius: "10px",
            background: "#fff",
            boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
            overflow: "hidden",
          }}
        >
          <aside
            style={{
              padding: 12,
              borderRight: "1px solid #eee",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              position: "relative",
              zIndex: "10",
              backgroundColor: "#fff",
            }}
          >
            <div>
              <h2>Toolbox</h2>
              <Palette
                setDraggingType={setDraggingType}
               onAdd={(type) =>
  setElements((els) => {
    if (type === "vsource") {
      return [
        ...els,
        {
          id: uid("V"),
          type: "vsource",
          x: 200,
          y: 200,
          rot: 0,
          waveType: "DC",
          dc: "5",
          acMag: "",
          acPhase: "",
          sin: { offset: "0", amp: "1", freq: "60", delay: "0", theta: "0", phase: "0" },
          pulse: { v1: "0", v2: "5", delay: "0", tr: "1u", tf: "1u", pw: "1m", per: "2m" },
          exp: { v1: "0", v2: "5", td1: "0", tau1: "1m", td2: "0", tau2: "1m" },
          pwl: "0 0, 1m 5, 2m 0",
        },
      ];
    }

    return [
      ...els,
      {
        id: uid(getIdPrefix(type)),

        type,
        x: 200,
        y: 200,
        rot: 0,
        value:
          type === "resistor"
            ? "1k"
            : type === "capacitor"
            ? "1u"
            : type === "inductor"
            ? "1m"
            : "",
      },
    ];
  })
}
              />
              <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
                Shift+클릭 다중선택
                <br />
                드래그 박스 선택
                <br />
                드래그: 선택된 소자 이동
                <br />
                R: 회전 / Delete: 삭제 / ESC: 연결 해제
              </p>
            </div>

            <div style={{ paddingTop: 10, borderTop: "1px solid #eee" }}>
              <h3 style={{ margin: "6px 0 8px" }}>Simulation Settings</h3>

              <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={useOp}
                  onChange={(e) => setUseOp(e.target.checked)}
                />{" "}
                .op
              </label>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={useTran}
                  onChange={(e) => setUseTran(e.target.checked)}
                />{" "}
                .tran
              </label>
              {useTran && (
                <div style={{ marginLeft: 10, fontSize: 12, display: "grid", gap: 6 }}>
                  <div>
                    Step:{" "}
                    <input
                      value={tranParams.step}
                      onChange={(e) =>
                        setTranParams({ ...tranParams, step: e.target.value })
                      }
                      size="6"
                    />
                  </div>
                  <div>
                    Stop:{" "}
                    <input
                      value={tranParams.stop}
                      onChange={(e) =>
                        setTranParams({ ...tranParams, stop: e.target.value })
                      }
                      size="6"
                    />
                  </div>
                  <div>
                    Start:{" "}
                    <input
                      value={tranParams.start}
                      onChange={(e) =>
                        setTranParams({ ...tranParams, start: e.target.value })
                      }
                      size="6"
                    />
                  </div>
                  <div>
                    MaxStep:{" "}
                    <input
                      value={tranParams.maxstep}
                      onChange={(e) =>
                        setTranParams({ ...tranParams, maxstep: e.target.value })
                      }
                      size="6"
                    />
                  </div>
                </div>
              )}

              <label
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={useAc}
                  onChange={(e) => setUseAc(e.target.checked)}
                />{" "}
                .ac
              </label>
              {useAc && (
                <div style={{ marginLeft: 10, fontSize: 12, display: "grid", gap: 6 }}>
                  <div>
                    Sweep:{" "}
                    <select
                      value={acParams.sweep}
                      onChange={(e) =>
                        setAcParams({ ...acParams, sweep: e.target.value })
                      }
                    >
                      <option value="dec">dec</option>
                      <option value="oct">oct</option>
                      <option value="lin">lin</option>
                    </select>
                  </div>
                  <div>
                    Points:{" "}
                    <input
                      value={acParams.points}
                      onChange={(e) =>
                        setAcParams({ ...acParams, points: e.target.value })
                      }
                      size="6"
                    />
                  </div>
                  <div>
                    Start:{" "}
                    <input
                      value={acParams.start}
                      onChange={(e) =>
                        setAcParams({ ...acParams, start: e.target.value })
                      }
                      size="8"
                    />
                  </div>
                  <div>
                    Stop:{" "}
                    <input
                      value={acParams.stop}
                      onChange={(e) =>
                        setAcParams({ ...acParams, stop: e.target.value })
                      }
                      size="8"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleExportNetlist}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #222",
                  background: "#111",
                  color: "#fff",
                  borderRadius: 8,
                  cursor: "pointer",
                  marginTop: 10,
                }}
              >
                📄 넷리스트 내보내기 (.net)
              </button>
              <button
                onClick={() => {
                  const net = generateNetlist();
                  console.clear();
                  console.log("=== NETLIST PREVIEW ===\n" + net);
                  alert("콘솔에 넷리스트가 출력되었습니다.");
                }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #444",
                  background: "#333",
                  color: "#fff",
                  borderRadius: 8,
                  cursor: "pointer",
                  marginTop: 6,
                }}
              >
                🔍 넷리스트 미리보기 (콘솔)
              </button>
            </div>

            <div
              style={{
                position: "absolute",
                right: -50,
                top: 20,
                zIndex: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <button onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}>＋</button>
              <button onClick={() => setZoom((z) => Math.max(z - 0.1, 0.3))}>－</button>
              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                ⟳
              </button>
            </div>
          </aside>

          <div
            className="viewport-wrapper"
            ref={canvasRef}
            // onWheel={handleWheel}
            style={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
              position: "relative",
              background: "#fff",
            }}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`
                ${-pan.x / zoom}
                ${-pan.y / zoom}
                ${viewportSize.width / zoom}
                ${viewportSize.height / zoom}
              `}
              onMouseLeave={handleSvgMouseUp}
              style={{
                zIndex: 1,
                background: "#fff",
                cursor: isPanning ? "grabbing" : "grab",
              }}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onDragOver={(e) => {
                e.preventDefault();
                const pt = clientToSvg(e, svgRef.current, pan, zoom);
                setDragPreview({ x: snap(pt.x), y: snap(pt.y) });
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDraggingType(null);
                setDragPreview(null);

                const type = e.dataTransfer.getData("type");
                if (!type) return;

                const pt = clientToSvg(e, svgRef.current, pan, zoom);
                const x = snap(pt.x);
                const y = snap(pt.y);

                const pos = alignOriginForPorts(type, 0, x, y);

                setElements((els) => [
                  ...els,
                  {
                    id: uid(getIdPrefix(type)),
                    type,
                    x: pos.x,
                    y: pos.y,
                    rot: 0,
                    value:
                      type === "resistor"
                        ? "1k"
                        : type === "capacitor"
                        ? "1u"
                        : type === "inductor"
                        ? "1m"
                        : type === "vsource"
                        ? "5"
                        : "",
                  },
                ]);

                setDragPreview(null);
              }}
              onDragLeave={() => setDragPreview(null)}
            >
              {dragPreview && draggingType && (
                <g style={{ opacity: 0.4, pointerEvents: "none" }}>
                  <React.Fragment key="dragPreview">
                    {DRAW_LIB[draggingType].draw({
                      x: dragPreview.x,
                      y: dragPreview.y,
                      rot: 0,
                    })}
               </React.Fragment>
                </g>
              )}

             <g>{gridLines.map((ln) => ln)}</g>


              {wires.map((w) => {
                const a = startPosOf(w.a);
                const b = startPosOf(w.b);
                const pts = bestOrthogonal(a, b);
                const d = `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]} L ${pts[4]} ${pts[5]}`;
                return (
                  <path
                    key={w.id}
                    d={d}
                    stroke="#111"
                    strokeWidth={2}
                    fill="none"
                    onClick={(e) => {
                      e.stopPropagation();
                      setWires((ws) => ws.filter((it) => it.id !== w.id));
                    }}
                  />
                );
              })}

              {connectFrom &&
                mousePos &&
                (() => {
                  const a = startPosOf({
                    el: connectFrom.elId,
                    portId: connectFrom.portId,
                  });

                  const b = { x: mousePos.x, y: mousePos.y };

                  const pts = stableOrthogonalPath(a, b, routingMode);

                  return (
                    <path
                      key="connecting-wire-preview"
                      d={`M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]} L ${pts[4]} ${pts[5]}`}
                      stroke="#2b8cff"
                      strokeWidth={2}
                      fill="none"
                      strokeDasharray="6 6"
                    />
                  );
                })()}

              {elements.map((el) => (
                <g
                  key={el.id}
                  style={{
                    color: selected.includes(el.id) ? "#2b8cff" : "#111",
                    cursor: "grab",
                  }}
                >
                  {(() => {
                    const box = getBBox(el);
                    return (
                      <rect
                        x={box.x}
                        y={box.y}
                        width={box.w}
                        height={box.h}
                        fill="transparent"
                        pointerEvents="all"
                        onMouseDown={(e) => onMouseDownPart(e, el)}
                      />
                    );
                  })()}

                  {DRAW_LIB[el.type].draw(el)}

                  <text
                    x={el.x + DRAW_LIB[el.type].w / 2}
                    y={el.y + DRAW_LIB[el.type].h + 2}
                    textAnchor="middle"
                    fontSize="12"
                    fill={selected.includes(el.id) ? "#2b8cff" : "#555"}
                    style={{ userSelect: "none" }}
                  >
                    {(() => {
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
                      const prefix = map[el.type] || "X";
                      const index =
                        elements.filter((e) => e.type === el.type).indexOf(el) + 1;
                      return `${prefix}${index}`;
                    })()}
                  </text>

                 <text
  x={el.x + DRAW_LIB[el.type].w / 2}
  y={el.y + DRAW_LIB[el.type].h + 16}
  textAnchor="middle"
  fontSize="12"
  fill={selected.includes(el.id) ? "#2b8cff" : "#333"}
  style={{ userSelect: "none" }}
>
  {(() => {
    if (el.type === "vsource") {
  switch (el.waveType) {
    case "DC":
      return `DC ${el.dc || 0}V`;
    case "AC":
      return `AC(${el.acMag || 1}, ${el.acPhase || 0}°)`;
    case "SIN": {
      const s = el.sin || {};
      return `SIN(${s.offset ?? 0}, ${s.amp ?? 1}, ${s.freq ?? 60})`;
    }
    case "PULSE": {
      const p = el.pulse || {};
      return `PULSE(${p.v1 ?? 0}→${p.v2 ?? 5})`;
    }
    case "EXP": {
      const e = el.exp || {};
      return `EXP(${e.v1 ?? 0}→${e.v2 ?? 5})`;
    }
    case "PWL":
      return `PWL(...)`;
    default:
      return `Vsrc`;
  }
}


    // resistor/cap/inductor text는 그대로 유지
    if (el.type === "resistor") return `${el.value ?? ""}Ω`;
    if (el.type === "capacitor") return `${el.value ?? ""}F`;
    if (el.type === "inductor") return `${el.value ?? ""}H`;

    return el.value ?? "";
  })()}
</text>


                  {DRAW_LIB[el.type].ports.map((p) => {
                    const { x: rx, y: ry } = portAbsolutePosition(el, p);

                    return (
                      <circle
                        key={`${el.id}-${p.id}`}
                        cx={rx}
                        cy={ry}
                        r={PORT_R}
                        fill={
                          connectFrom &&
                          connectFrom.elId === el.id &&
                          connectFrom.portId === p.id
                            ? "#2b8cff"
                            : "#fff"
                        }
                        stroke="#2b8cff"
                        strokeWidth={2}
                        onMouseDown={(e) => handlePortMouseDown(e, el.id, p.id)}
                        onMouseUp={(e) => handlePortMouseUp(e, el.id, p.id)}
                        style={{ cursor: "crosshair" }}
                      />
                    );
                  })}
                </g>
              ))}

              {box && (
                <rect
                  x={Math.min(box.x1, box.x2)}
                  y={Math.min(box.y1, box.y2)}
                  width={Math.abs(box.x2 - box.x1)}
                  height={Math.abs(box.y2 - box.y1)}
                  fill="rgba(43,140,255,0.1)"
                  stroke="#2b8cff"
                  strokeDasharray="4 2"
                />
              )}
            </svg>

            {inspector && (
              <InspectorPopup
                inspector={inspector}
                elements={elements}
                setElements={setElements}
                setInspector={setInspector}
                pan={pan}
                zoom={zoom}
              />
            )}
          </div>
        </div>
      </div>

      <Simulbox>
        <div style={{ padding: "16px" }}>
          <button
            onClick={runSimulation}
            style={{
              padding: "10px 16px",
              background: "#2b8cff",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ⚡ 시뮬레이션 실행
          </button>

          <pre
            style={{
              marginTop: "16px",
              background: "#f9f9f9",
              borderRadius: 6,
              height: "470px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
              fontSize: "12px",
              width: "95%",
              padding: "20px",
            }}
          >
            {simOutput || "시뮬레이션 결과가 여기에 표시됩니다."}
          </pre>
        </div>
      </Simulbox>

      <GraphBox>
        <SimulationGraph simOutput={simOutput} />
      </GraphBox>
    </>

    
  );
  
}



function Palette({ onAdd, setDraggingType }) {
  const items = [
    { key: "resistor", label: "Resistor (R)" },
    { key: "capacitor", label: "Capacitor (C)" },
    { key: "inductor", label: "Inductor (L)" },
    { key: "vsource", label: "V Source (DC)" },
    { key: "ground", label: "Ground" },
    /* { key: "diode", label: "Diode (D)" },
    { key: "led", label: "LED" },
    { key: "npn", label: "Transistor (NPN)" },
    { key: "pnp", label: "Transistor (PNP)" },
    { key: "nmos", label: "NMOS" },
    { key: "pmos", label: "PMOS" }, */
  ];

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map((it) => (
        <div
          key={it.key}
          draggable
          onDragStart={(e) => {
           setDraggingType(it.key);
           // 🔥 드롭에서 getData("type")으로 읽으니까 여기에 반드시 넣어줘야 함
           e.dataTransfer.setData("type", it.key);
           // 기존 text/plain도 필요하면 같이 유지
           e.dataTransfer.setData("text/plain", it.key);
         }}
         onClick={() => {
           // 클릭으로도 추가하고 싶으면 이렇게 사용
           onAdd?.(it.key);
         }}
          style={{
            border: "1px solid #ddd",
            background: "#fafafa",
            padding: "10px 12px",
            borderRadius: 10,
            cursor: "grab",
            userSelect: "none",
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}

function clientToSvg(evt, svgEl, pan, zoom) {
  if (!svgEl) return { x: 0, y: 0 };

  const rect = svgEl.getBoundingClientRect();
  const sx = evt.clientX - rect.left;
  const sy = evt.clientY - rect.top;

  const x = sx / zoom - pan.x / zoom;
  const y = sy / zoom - pan.y / zoom;

  return { x, y };
}

function InspectorPopup({ inspector, elements, setElements, setInspector, pan, zoom }) {
  const el = elements.find((e) => e.id === inspector.id);
  if (!el) return null;

  const def = DRAW_LIB[el.type];

  // 화면 좌표 계산
  const screenX = (el.x + def.w / 2) * zoom + pan.x;
  const screenY = (el.y - 20) * zoom + pan.y;

  // Field 업데이트
  const updateField = (patch) => {
    setElements((els) =>
      els.map((it) => (it.id === el.id ? { ...it, ...patch } : it))
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: "translate(-50%, -100%)",
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 6,
        padding: "10px",
        fontSize: 12,
        zIndex: 1000,
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        minWidth: "200px",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ----------- Title (R1, C1, V1 등) ----------- */}
      <div style={{ fontWeight: "bold", marginBottom: 8 }}>
        {(() => {
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
          const prefix = map[el.type] || "X";
          const index = elements.filter((e) => e.type === el.type).indexOf(el) + 1;
          return `${prefix}${index}`;
        })()}
      </div>

      {/* ----------- 공통 Value (Vsource 제외) ----------- */}
      {el.type !== "ground" && el.type !== "vsource" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "80px 1fr",
            gap: "6px",
            marginBottom: "10px",
          }}
        >
          <div>Value</div>
          <input
            style={{ width: "90%", padding: "3px" }}
            value={el.value || ""}
            onChange={(e) => updateField({ value: e.target.value })}
          />
        </div>
      )}

      {/* ----------- Vsource 전용 설정 ----------- */}
      {el.type === "vsource" && (
        <div>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Waveform</div>

          {/* waveType dropdown */}
          <select
            value={el.waveType}
            onChange={(e) => updateField({ waveType: e.target.value })}
            style={{ width: "100%", marginBottom: 10 }}
          >
            <option value="DC">DC</option>
            <option value="AC">AC</option>
            <option value="SIN">SIN</option>
            <option value="PULSE">PULSE</option>
            <option value="EXP">EXP</option>
            <option value="PWL">PWL</option>
          </select>

          {/* ---- DC ---- */}
          {el.waveType === "DC" && (
            <div>
              <div>DC Value (V)</div>
              <input
                value={el.dc}
                onChange={(e) => updateField({ dc: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
          )}

          {/* ---- AC ---- */}
          {el.waveType === "AC" && (
            <>
              <div>AC Magnitude</div>
              <input
                value={el.acMag}
                onChange={(e) => updateField({ acMag: e.target.value })}
                style={{ width: "100%" }}
              />

              <div>AC Phase</div>
              <input
                value={el.acPhase}
                onChange={(e) => updateField({ acPhase: e.target.value })}
                style={{ width: "100%" }}
              />
            </>
          )}

          {/* ---- SIN ---- */}
          {el.waveType === "SIN" && (
            <>
              {["offset", "amp", "freq", "delay", "theta", "phase"].map((key) => (
                <div key={key}>
                  <div>{key}</div>
                  <input
                    value={el.sin[key]}
                    onChange={(e) =>
                      updateField({ sin: { ...el.sin, [key]: e.target.value } })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </>
          )}

          {/* ---- PULSE ---- */}
          {el.waveType === "PULSE" && (
            <>
              {["v1", "v2", "delay", "tr", "tf", "pw", "per"].map((key) => (
                <div key={key}>
                  <div>{key}</div>
                  <input
                    value={el.pulse[key]}
                    onChange={(e) =>
                      updateField({ pulse: { ...el.pulse, [key]: e.target.value } })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </>
          )}

          {/* ---- EXP ---- */}
          {el.waveType === "EXP" && (
            <>
              {["v1", "v2", "td1", "tau1", "td2", "tau2"].map((key) => (
                <div key={key}>
                  <div>{key}</div>
                  <input
                    value={el.exp[key]}
                    onChange={(e) =>
                      updateField({ exp: { ...el.exp, [key]: e.target.value } })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </>
          )}

          {/* ---- PWL ---- */}
          {el.waveType === "PWL" && (
            <>
              <div>PWL Points</div>
              <textarea
                value={el.pwl}
                onChange={(e) => updateField({ pwl: e.target.value })}
                style={{ width: "100%" }}
              />
            </>
          )}
        </div>
      )}

      {/* -------- 회전 버튼 -------- */}
      <button
        style={{
          width: "100%",
          marginTop: 10,
          padding: "6px 0",
          border: "1px solid #aaa",
          borderRadius: 4,
          background: "#f5f5f5",
          cursor: "pointer",
        }}
        onClick={() => updateField({ rot: (el.rot + 90) % 360 })}
      >
        Rotate
      </button>
    </div>
  );
}

