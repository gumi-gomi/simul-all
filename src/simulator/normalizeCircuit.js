// src/simulator/normalizeCircuit.js

/**
 * GPT가 준 회로 JSON을 캔버스/넷리스트에 맞게 보정한다.
 * 입력/출력 스키마:
 *   in:  { components: [...], connections: [...] }
 *   out: { components: [...], connections: [...] }  (모두 정규화됨)
 *
 * drawLib: DRAW_LIB 그대로 넣으면 포트/타입 검증에 사용.
 */

const GRID = 10;
const snap = (v) => Math.round((v ?? 0) / GRID) * GRID;

/** 1) 타입/포트 표준화 매핑 */
const TYPE_ALIASES = {
  resistor: "resistor", r: "resistor",
  capacitor: "capacitor", c: "capacitor", cap: "capacitor",
  capacitor_polarized: "capacitor_polarized", electrolytic: "capacitor_polarized",
  inductor: "inductor", l: "inductor",
  diode: "diode", d: "diode",
  led: "led",
  zener: "zener", zenerdiode: "zener",
  vsource: "vsource", vs: "vsource", voltage: "vsource", v: "vsource",
  isource: "isource", is: "isource", current: "isource",
  ground: "ground", gnd: "ground", 0: "ground",
  npn: "npn", pnp: "pnp",
  nmos: "nmos", pmos: "pmos",
  opamp: "opamp", opa: "opamp", ua741: "opamp",
  transformer: "transformer", xfmr: "transformer",
  crystal: "crystal", xtal: "crystal"
};

/** 포트 별칭 표준화(타입별) */
const PORT_ALIASES = {
  resistor:   { "1":"1","2":"2","a":"1","b":"2","p":"1","n":"2","+":"1","-":"2" },
  capacitor:  { "1":"1","2":"2","a":"1","b":"2","p":"1","n":"2","+":"1","-":"2" },
  capacitor_polarized: { "1":"1","2":"2","+":"1","-":"2","p":"1","n":"2","a":"1","b":"2" },
  inductor:   { "1":"1","2":"2","a":"1","b":"2","p":"1","n":"2","+":"1","-":"2" },

  diode:      { "a":"A","anode":"A","k":"K","cathode":"K","1":"A","2":"K","+":"A","-":"K" },
  led:        { "a":"A","anode":"A","k":"K","cathode":"K","1":"A","2":"K","+":"A","-":"K" },
  zener:      { "a":"A","anode":"A","k":"K","cathode":"K","1":"A","2":"K","+":"A","-":"K" },

  vsource:    { "+":"+","-":"-","p":"+","n":"-","pos":"+","neg":"-" },
  isource:    { "p":"p","n":"n","+":"p","-":"n","pos":"p","neg":"n" },

  npn:        { "b":"B","base":"B","c":"C","collector":"C","e":"E","emitter":"E" },
  pnp:        { "b":"B","base":"B","c":"C","collector":"C","e":"E","emitter":"E" },

  nmos:       { "g":"G","gate":"G","d":"D","drain":"D","s":"S","source":"S" },
  pmos:       { "g":"G","gate":"G","d":"D","drain":"D","s":"S","source":"S" },

  opamp:      { "in+":"IN+","vin+":"IN+","noninv":"IN+",
                "in-":"IN-","vin-":"IN-","inv":"IN-",
                "out":"OUT","o":"OUT" },

  transformer:{ "p_a":"P_A","p_b":"P_B","s_a":"S_A","s_b":"S_B","pa":"P_A","pb":"P_B","sa":"S_A","sb":"S_B" },

  crystal:    { "1":"1","2":"2","a":"1","b":"2" },

  ground:     { "0":"GND","gnd":"GND","g":"GND","ground":"GND" },
};

/** 2) 존재하는 포트인지 검사 */
function getNormalizedPortId(type, rawPortId, drawLib) {
  const t = TYPE_ALIASES[type?.toLowerCase()] || type?.toLowerCase();
  if (!t) return null;
  const aliasMap = PORT_ALIASES[t] || {};
  const normalized = aliasMap[String(rawPortId ?? "").toLowerCase()] || String(rawPortId || "");
  const def = drawLib[t];
  if (!def?.ports) return null;
  const hit = def.ports.find((p) => p.id === normalized);
  return hit ? hit.id : null;
}

/** 3) 타입 정규화 */
function normalizeType(type) {
  if (!type) return null;
  const key = String(type).toLowerCase();
  return TYPE_ALIASES[key] || null;
}

/** 4) 아이디 정규화: 공백 제거/대문자 → 그대로, 미존재시 생성 금지(여기선 그대로 사용) */
function normalizeId(id) {
  if (!id) return null;
  return String(id).trim();
}

/** 5) 좌표/회전 보정 */
function normalizePlacement(c) {
  return {
    x: snap(c.x ?? 200),
    y: snap(c.y ?? 200),
    rot: Number.isFinite(c.rot) ? c.rot : 0,
  };
}

/** 6) ground 연결 표준화: "GND1.0" "GND1.GND" "0" 전부 허용 */
function isGroundPortRef(elId, portId, compById, drawLib) {
  if (!elId) return false;
  const comp = compById.get(elId);
  if (!comp) return false;
  if (comp.type === "ground") return true;
  // “0”만 주는 경우도 허용(나중 단계에서 ground로 바인딩)
  if (portId === "0") return true;
  // drawLib로 확인
  const def = drawLib[comp.type];
  return !!def && comp.type === "ground";
}

/** 7) 연결 키(정렬) */
function joinKey(a, b) {
  const ka = `${a.el}.${a.portId}`;
  const kb = `${b.el}.${b.portId}`;
  return ka < kb ? `${ka}__${kb}` : `${kb}__${ka}`;
}

/** ===== 메인: 정규화 ===== */
export function normalizeCircuitJson(input, drawLib) {
  const out = { components: [], connections: [] };
  const seenIds = new Set();

  // 1) 컴포넌트 정규화/필터링
  for (const c of input.components || []) {
    const type = normalizeType(c.type);
    const id = normalizeId(c.id);
    if (!type || !id) continue;
    if (!drawLib[type]) continue; // 우리 라이브러리에 없는 타입이면 제외
    if (seenIds.has(id)) continue; // id 중복 skip
    seenIds.add(id);

    const place = normalizePlacement(c);

    // 값 기본치(필요한 소자만)
    let value = c.value ?? "";
    if (type === "resistor" && !value) value = "1k";
    if (type === "capacitor" && !value) value = "1u";
    if (type === "inductor" && !value) value = "1m";

    // 전/전류원 파형 기본치
    let patch = {};
    if (type === "vsource") {
      patch.waveType = (c.waveType || "DC").toUpperCase();
      if (patch.waveType === "DC") patch.dc = c.dc ?? "5";
      if (patch.waveType === "AC") patch.ac = c.ac ?? "1";
      if (patch.waveType === "SIN") {
        patch.sin = c.sin || { vo: "0", va: "5", freq: "1k", td: "0", theta: "0", phi: "0" };
      }
    }
    if (type === "isource") {
      patch.waveType = (c.waveType || "DC").toUpperCase();
      if (patch.waveType === "DC") patch.dc = c.dc ?? "1m";
      if (patch.waveType === "AC") patch.ac = c.ac ?? "1";
      if (patch.waveType === "SIN") {
        patch.sin = c.sin || { io: "0", ia: "1m", freq: "1k", td: "0", theta: "0", phi: "0" };
      }
    }

    out.components.push({
      id, type,
      value,
      ...place,
      ...patch,
    });
  }

  // 2) 컴포넌트 맵
  const compById = new Map(out.components.map((c) => [c.id, c]));

  // 3) ground 부품이 하나도 없으면, 연결에서 '0'을 쓰더라도 자동으로 추가
  const hasGround = out.components.some((c) => c.type === "ground");
  if (!hasGround) {
    const usesZero = (input.connections || []).some((conn) => {
      const [, pA] = String(conn.from || "").split(".");
      const [, pB] = String(conn.to || "").split(".");
      return (pA === "0" || pB === "0");
    });
    if (usesZero) {
      out.components.unshift({
        id: "GND1",
        type: "ground",
        x: snap(120),
        y: snap(120),
        rot: 0,
      });
      compById.set("GND1", out.components[0]);
    }
  }

  // 4) 연결 정규화
  const seenConn = new Set();
  for (const conn of input.connections || []) {
    if (!conn?.from || !conn?.to) continue;

    const [rawA, rawAp] = String(conn.from).split(".");
    const [rawB, rawBp] = String(conn.to).split(".");
    let elA = normalizeId(rawA);
    let elB = normalizeId(rawB);
    let pA  = rawAp ? String(rawAp).trim() : "";
    let pB  = rawBp ? String(rawBp).trim() : "";

    // "0"만 준 경우 → GND에 붙이기
    if (pA === undefined && elA === "0") { elA = "GND1"; pA = "GND"; }
    if (pB === undefined && elB === "0") { elB = "GND1"; pB = "GND"; }

    // 컴포넌트 존재여부
    const ca = compById.get(elA);
    const cb = compById.get(elB);
    if (!ca || !cb) continue;

    // 포트 정규화
    const nA = getNormalizedPortId(ca.type, pA, drawLib) || (pA === "0" ? "GND" : null);
    const nB = getNormalizedPortId(cb.type, pB, drawLib) || (pB === "0" ? "GND" : null);
    if (!nA || !nB) continue;

    // ground 참조가 “0”이면 해당 엘리먼트를 ground로 강제
    if (pA === "0" && ca.type !== "ground") {
      // elA가 ground가 아니면 연결 불가 → GND1로 리다이렉트
      elA = "GND1";
    }
    if (pB === "0" && cb.type !== "ground") {
      elB = "GND1";
    }

    const a = { el: elA, portId: nA };
    const b = { el: elB, portId: nB };

    // 중복 제거 (무향)
    const key = joinKey(a, b);
    if (seenConn.has(key)) continue;
    seenConn.add(key);

    // 자기 자신 동일 포트 연결은 무시
    if (a.el === b.el && a.portId === b.portId) continue;

    out.connections.push({ from: `${a.el}.${a.portId}`, to: `${b.el}.${b.portId}` });
  }

  return out;
}
