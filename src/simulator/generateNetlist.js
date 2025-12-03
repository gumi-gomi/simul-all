// src/simulator/generateNetlist.js
// 캔버스 elements, wires → ngspice 호환 netlist 생성 (서버 배치/RAW 모드 대응)
// 포함: R/C/L/GND, V/I 소스(DC/AC/SIN), D/LED/Zener, BJT(NPN/PNP), MOSFET(NMOS/PMOS),
//      Transformer(L1/L2/K), OpAmp(이상적 VCVS)

/** ===== 유틸: Disjoint Set ===== */
class DSU {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x); const px = this.p.get(x); if (px === x) return x; const r = this.find(px); this.p.set(x, r); return r; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

/** ===== 기본 파라미터/모델 ===== */
const DEFAULTS = {
  R: { value: "1k" },
  C: { value: "1u" },
  L: { value: "1m" },

  VSRC: { // 전압원
    waveType: "DC", // DC | AC | SIN
    dc: "5",
    ac: "1",
    sin: { vo: "0", va: "5", freq: "1k", td: "0", theta: "0", phi: "0" },
  },

  ISRC: { // 전류원
    waveType: "DC",
    dc: "1m",
    ac: "1",
    sin: { io: "0", ia: "1m", freq: "1k", td: "0", theta: "0", phi: "0" },
  },

  // 다이오드 계열
  D:      { model: "DDEFAULT", params: { IS: "1e-14", N: "1" } },
  LED:    { model: "LED",      params: { IS: "1e-14", N: "2" } },
  DZENER: { model: "DZEN",     params: { IS: "5e-12", N: "1.5", BV: "5.1", IBV: "5m" } },

  // BJT
  NPN: { model: "NPN_DEFAULT", params: { IS: "1e-14", BF: "100" } },
  PNP: { model: "PNP_DEFAULT", params: { IS: "1e-14", BF: "100" } },

  // MOSFET
  NMOS: { model: "NMOS_DEFAULT", params: { LEVEL: "1", VTO: "1", KP: "1e-3", LAMBDA: "0.02" } },
  PMOS: { model: "PMOS_DEFAULT", params: { LEVEL: "1", VTO: "-1", KP: "1e-3", LAMBDA: "0.02" } },

  // 트랜스포머
  XFMR: { lp: "10m", ls: "10m", k: "0.99" },

  // OPAMP
  OPAMP: { gain: "1e6" },

  // 해석 기본값
  TRAN: { step: "1m", stop: "1s" },
};

/** 숫자/문자 단위 허용 */
const fmtVal = (v) => (typeof v === "number" ? String(v) : (v ?? ""));

/** ===== Node 계산: 포트 좌표 기반 ===== */
function computeNodes(elements, wires, drawLib, grid = 10) {
  const dsu = new DSU();
  const anchors = []; // {key, x,y, elId, portId}

  // 요소 포트 → 절대좌표
  for (const el of elements) {
    const sym = drawLib[el.type];
    if (!sym || !Array.isArray(sym.ports)) continue;
    for (const p of sym.ports) {
      let ax = el.x + p.x, ay = el.y + p.y;

      const rot = (el.rot || 0) % 360;
      if (rot === 90) { ax = el.x + p.y; ay = el.y + (sym.w - p.x); }
      else if (rot === 180) { ax = el.x + (sym.w - p.x); ay = el.y + (sym.h - p.y); }
      else if (rot === 270) { ax = el.x + (sym.h - p.y); ay = el.y + p.x; }

      ax = Math.round(ax / grid) * grid;
      ay = Math.round(ay / grid) * grid;

      anchors.push({ key: `P:${el.id}:${p.id}`, x: ax, y: ay });
    }
  }

  // 포트끼리 같은 좌표 → union
  const mapAt = new Map();
  for (const a of anchors) {
    const k = `${a.x},${a.y}`;
    if (!mapAt.has(k)) mapAt.set(k, []);
    mapAt.get(k).push(a.key);
  }
  for (const arr of mapAt.values()) {
    for (let i = 1; i < arr.length; i++) dsu.union(arr[0], arr[i]);
  }

  // 와이어 점 → 포트와 같은 좌표면 union
  const wirePoints = [];
  for (const w of wires || []) {
    if (Array.isArray(w.points)) {
      for (const pt of w.points)
        wirePoints.push({ x: Math.round(pt.x / grid) * grid, y: Math.round(pt.y / grid) * grid });
    } else {
      const x1 = Math.round((w.x1 ?? 0) / grid) * grid;
      const y1 = Math.round((w.y1 ?? 0) / grid) * grid;
      const x2 = Math.round((w.x2 ?? 0) / grid) * grid;
      const y2 = Math.round((w.y2 ?? 0) / grid) * grid;
      wirePoints.push({ x: x1, y: y1 }, { x: x2, y: y2 });
    }
  }

  const anchorAt = new Map();
  for (const a of anchors) {
    const k = `${a.x},${a.y}`;
    if (!anchorAt.has(k)) anchorAt.set(k, []);
    anchorAt.get(k).push(a.key);
  }
  for (const wp of wirePoints) {
    const k = `${wp.x},${wp.y}`;
    const arr = anchorAt.get(k);
    if (!arr) continue;
    for (let i = 1; i < arr.length; i++) dsu.union(arr[0], arr[i]);
  }

  // 그라운드 인식
  const ground = "GNDROOT";
  dsu.union(ground, ground);

  const groundRoots = new Set();
  for (const el of elements) {
    if (el.type !== "ground") continue;
    const pk = `P:${el.id}:GND`;
    dsu.union(pk, ground);
    groundRoots.add(dsu.find(pk));
  }

  // 네트 이름 부여
  const roots = new Map();
  let idx = 1;
  const getNode = (key) => {
    const r = dsu.find(key);
    if (r === ground || groundRoots.has(r)) return "0";
    if (!roots.has(r)) roots.set(r, `N${idx++}`);
    return roots.get(r);
  };

  return { getNode };
}

/** ===== 모델 문자열 ===== */
function modelLine(kind, name, params = {}) {
  const pairs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" ");
  return `.model ${name} ${kind}(${pairs})`;
}

/** ===== 메인 Netlist 생성 ===== */
export function generateNetlist(elements, wires, drawLib, opts = {}) {
  const { getNode } = computeNodes(elements, wires, drawLib);
  const lines = [];
  const models = new Set();
  const extras = [];
  const ref = { R:0, C:0, L:0, V:0, I:0, D:0, Q:0, M:0, K:0, Lxf:0, E:0 };

  const header = [
    `* ELECHUB AUTO-GENERATED NETLIST`,
    `.title ELECHUB_CIRCUIT`,
  ];

  for (const el of elements) {
    const t = el.type;
    const sym = drawLib[t];
    if (!sym || !Array.isArray(sym.ports)) continue;
    if (t === "ground") continue;

    const ports = {};
    for (const p of sym.ports) {
      ports[p.id] = getNode(`P:${el.id}:${p.id}`);
    }

    /** 1) R */
    if (t === "resistor") {
      const name = `R${++ref.R}`;
      const v = el.value ?? DEFAULTS.R.value;
      lines.push(`${name} ${ports["1"]} ${ports["2"]} ${v}`);
      continue;
    }
    /** 2) C */
    if (t === "capacitor" || t === "capacitor_polarized") {
      const name = `C${++ref.C}`;
      const v = el.value ?? DEFAULTS.C.value;
      lines.push(`${name} ${ports["1"]} ${ports["2"]} ${v}`);
      continue;
    }
    /** 3) L */
    if (t === "inductor") {
      const name = `L${++ref.L}`;
      const v = el.value ?? DEFAULTS.L.value;
      lines.push(`${name} ${ports["1"]} ${ports["2"]} ${v}`);
      continue;
    }

    /** 4) Vsource */
    if (t === "vsource") {
      const name = `V${++ref.V}`;
      const plus = ports["+"] ?? "0";
      const minus = ports["-"] ?? "0";
      const wave = (el.waveType || DEFAULTS.VSRC.waveType).toUpperCase();
      let s = `${name} ${plus} ${minus}`;

      if (wave === "DC") {
        s += ` DC ${fmtVal(el.dc ?? DEFAULTS.VSRC.dc)}`;
      } else if (wave === "AC") {
        s += ` AC ${fmtVal(el.ac ?? DEFAULTS.VSRC.ac)}`;
      } else if (wave === "SIN") {
        const sin = el.sin || DEFAULTS.VSRC.sin;
        s += ` SIN(${fmtVal(sin.vo)} ${fmtVal(sin.va)} ${fmtVal(sin.freq)} ${fmtVal(sin.td)} ${fmtVal(sin.theta)} ${fmtVal(sin.phi)})`;
      } else {
        s += ` DC 0`;
      }
      lines.push(s);
      continue;
    }

    /** 5) ISource */
    if (t === "isource") {
      const name = `I${++ref.I}`;
      const p = ports["p"], n = ports["n"];
      const wave = (el.waveType || DEFAULTS.ISRC.waveType).toUpperCase();
      let s = `${name} ${p} ${n}`;

      if (wave === "DC") {
        s += ` DC ${fmtVal(el.dc ?? DEFAULTS.ISRC.dc)}`;
      } else if (wave === "AC") {
        s += ` AC ${fmtVal(el.ac ?? DEFAULTS.ISRC.ac)}`;
      } else if (wave === "SIN") {
        const sin = el.sin || DEFAULTS.ISRC.sin;
        s += ` SIN(${fmtVal(sin.io)} ${fmtVal(sin.ia)} ${fmtVal(sin.freq)} ${fmtVal(sin.td)} ${fmtVal(sin.theta)} ${fmtVal(sin.phi)})`;
      } else {
        s += ` DC 0`;
      }
      lines.push(s);
      continue;
    }

    /** 6) Diode / LED / Zener */
    if (t === "diode" || t === "led" || t === "zener") {
      const name = `D${++ref.D}`;
      const a = ports["A"], k = ports["K"];

      if (t === "diode") {
        const mdl = el.model || DEFAULTS.D.model;
        const prm = el.params || DEFAULTS.D.params;
        models.add(modelLine("D", mdl, prm));
        lines.push(`${name} ${a} ${k} ${mdl}`);
      } else if (t === "led") {
        const mdl = el.model || DEFAULTS.LED.model;
        const prm = el.params || DEFAULTS.LED.params;
        models.add(modelLine("D", mdl, prm));
        lines.push(`${name} ${a} ${k} ${mdl}`);
      } else if (t === "zener") {
        const mdl = el.model || DEFAULTS.DZENER.model;
        const prm = el.params || DEFAULTS.DZENER.params;
        models.add(modelLine("D", mdl, prm));
        lines.push(`${name} ${a} ${k} ${mdl}`);
      }
      continue;
    }

    /** 7) BJT */
    if (t === "npn" || t === "pnp") {
      const name = `Q${++ref.Q}`;
      const c = ports["C"], b = ports["B"], e = ports["E"];
      if (t === "npn") {
        const mdl = el.model || DEFAULTS.NPN.model;
        const prm = el.params || DEFAULTS.NPN.params;
        models.add(modelLine("NPN", mdl, prm));
        lines.push(`${name} ${c} ${b} ${e} ${mdl}`);
      } else {
        const mdl = el.model || DEFAULTS.PNP.model;
        const prm = el.params || DEFAULTS.PNP.params;
        models.add(modelLine("PNP", mdl, prm));
        lines.push(`${name} ${c} ${b} ${e} ${mdl}`);
      }
      continue;
    }

    /** 8) MOSFET */
    if (t === "nmos" || t === "pmos") {
      const name = `M${++ref.M}`;
      const d = ports["D"], g = ports["G"], s = ports["S"];
      const b = el.body ? ports[el.body] : s;

      if (t === "nmos") {
        const mdl = el.model || DEFAULTS.NMOS.model;
        const prm = el.params || DEFAULTS.NMOS.params;
        models.add(modelLine("NMOS", mdl, prm));
        lines.push(`${name} ${d} ${g} ${s} ${b} ${mdl}`);
      } else {
        const mdl = el.model || DEFAULTS.PMOS.model;
        const prm = el.params || DEFAULTS.PMOS.params;
        models.add(modelLine("PMOS", mdl, prm));
        lines.push(`${name} ${d} ${g} ${s} ${b} ${mdl}`);
      }
      continue;
    }

    /** 9) Transformer */
    if (t === "transformer") {
      const L1 = `L${++ref.Lxf}`;
      const L2 = `L${++ref.Lxf}`;
      const K  = `K${++ref.K}`;

      const lp = el.lp || DEFAULTS.XFMR.lp;
      const ls = el.ls || DEFAULTS.XFMR.ls;
      const k  = el.k  || DEFAULTS.XFMR.k;

      extras.push(`${L1} ${ports["P_A"]} ${ports["P_B"]} ${lp}`);
      extras.push(`${L2} ${ports["S_A"]} ${ports["S_B"]} ${ls}`);
      extras.push(`${K} ${L1} ${L2} ${k}`);
      continue;
    }

    /** 10) OpAmp (Ideal VCVS) */
    if (t === "opamp") {
      const name = `E${++ref.E}`;
      const vp = ports["IN+"] ?? "0";
      const vn = ports["IN-"] ?? "0";
      const out = ports["OUT"] ?? "0";
      const gain = el.gain || DEFAULTS.OPAMP.gain;
      extras.push(`${name} ${out} 0 ${vp} ${vn} ${gain}`);
      continue;
    }

    /** 기타 2포트 */
    const a = sym.ports[0]?.id;
    const b = sym.ports[1]?.id;
    if (a && b) {
      lines.push(`X? ${ports[a]} ${ports[b]}`);
    }
  }

  const footer = [
    ``,
    `.control`,
    `  set noaskquit`,
    `  tran ${opts.tranStep || DEFAULTS.TRAN.step} ${opts.tranStop || DEFAULTS.TRAN.stop}`,
    `  print all`,
    `.endc`,
    `.end`,
  ];

  return []
    .concat(header)
    .concat([...models])
    .concat(lines)
    .concat(extras)
    .concat(footer)
    .join("\n");
}
