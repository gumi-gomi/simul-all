// src/simulator/parseAsy.js
//
// LTspice .ASY 완전 지원 파서
// - 지원: LINE, RECTANGLE/RECT, CIRCLE, ARC(점/각도), POLYLINE, TEXT, PIN, PINATTR, SYMATTR
// - 좌표 정규화: bbox 좌상단을 (0,0)로 이동
// - 결과 포맷:
//   {
//     w, h,
//     prefix,         // SYMATTR Prefix
//     type,           // prefix 기반 추론형 (resistor/capacitor/inductor/vsource/diode/npn/nmos/pmos/…)
//     pins: [{id,name,x,y,orientation}],
//     shapes: [...],  // {type:'line'|'rect'|'circle'|'arc'|'polyline', ...}
//     texts:  [...],  // {x,y,size,align,text}
//     bbox: {x1,y1,x2,y2}
//   }

const NUM = (s) => Number(s);

// 주석/빈줄 필터
function cleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(";"));
}

function parseTextPayload(raw) {
  // LTspice TEXT 라인: TEXT x y Align Size ;payload
  const sc = raw.indexOf(";");
  if (sc >= 0) return raw.slice(sc + 1).trim();

  // 예외: 작은따옴표로 감싼 경우
  const m = raw.match(/'(.*)'/);
  return m ? m[1] : "";
}

function arcFromPointsOrAngles(parts) {
  // ARC Normal cx cy x1 y1 x2 y2  (점 기반)
  // ARC Normal cx cy r a1 a2 [w]  (각도 기반)
  const cx = NUM(parts[2]);
  const cy = NUM(parts[3]);

  // 점 기반: 길이가 8 이상이면 x1 y1 x2 y2 존재
  if (parts.length >= 8 && !isNaN(NUM(parts[4])) && !isNaN(NUM(parts[5])) && !isNaN(NUM(parts[6])) && !isNaN(NUM(parts[7]))) {
    const x1 = NUM(parts[4]);
    const y1 = NUM(parts[5]);
    const x2 = NUM(parts[6]);
    const y2 = NUM(parts[7]);
    const r = Math.hypot(x1 - cx, y1 - cy);
    return { cx, cy, r, x1, y1, x2, y2, mode: "points" };
  }

  // 각도 기반
  const r = NUM(parts[4]);
  const a1 = NUM(parts[5]);
  const a2 = NUM(parts[6]);
  return { cx, cy, r, a1, a2, mode: "angles" };
}

// Prefix → 일반화된 type 추론
function typeFromPrefix(prefix, pinCount) {
  if (!prefix) return null;

  const p = String(prefix).trim().toUpperCase();
  switch (p) {
    case "R": return "resistor";
    case "C": return "capacitor";
    case "L": return "inductor";
    case "V": return "vsource";
    case "I": return "isource";
    case "D": return "diode";           // LED도 보통 D prefix를 씀
    case "Q": return "npn";             // 세부(NPN/PNP)는 .asy로 구분 어려워 기본 npn
    case "M": return "nmos";            // 세부(nmos/pmos)는 심볼명/SpiceLine 필요
    case "U": // OpAmp/IC류
      // 핀 수가 많으면 opamp로 가정 (대략적)
      return pinCount >= 5 ? "opamp" : "ic";
    default:
      return null;
  }
}

export function parseASY(text) {
  const lines = cleanLines(text);

  const out = {
    shapes: [],
    texts: [],
    pins: [],
    bbox: { x1: +Infinity, y1: +Infinity, x2: -Infinity, y2: -Infinity },
    prefix: null,
    type: null,
    w: 40,
    h: 40,
  };

  const track = (x, y) => {
    if (x < out.bbox.x1) out.bbox.x1 = x;
    if (y < out.bbox.y1) out.bbox.y1 = y;
    if (x > out.bbox.x2) out.bbox.x2 = x;
    if (y > out.bbox.y2) out.bbox.y2 = y;
  };

  const lastPin = () => out.pins[out.pins.length - 1];

  for (const raw of lines) {
    const parts = raw.split(/\s+/);
    const cmd = parts[0];

    // ----- LINE -----
    if (cmd === "LINE") {
      // LINE Normal x1 y1 x2 y2
      const x1 = NUM(parts[2]);
      const y1 = NUM(parts[3]);
      const x2 = NUM(parts[4]);
      const y2 = NUM(parts[5]);
      if ([x1, y1, x2, y2].every((n) => !isNaN(n))) {
        out.shapes.push({ type: "line", x1, y1, x2, y2 });
        track(x1, y1); track(x2, y2);
      }
      continue;
    }

    // ----- RECTANGLE / RECT -----
    if (cmd === "RECTANGLE" || cmd === "RECT") {
      // RECTANGLE Normal x1 y1 x2 y2
      const x1 = NUM(parts[2]);
      const y1 = NUM(parts[3]);
      const x2 = NUM(parts[4]);
      const y2 = NUM(parts[5]);
      if ([x1, y1, x2, y2].every((n) => !isNaN(n))) {
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        out.shapes.push({ type: "rect", x, y, w, h });
        track(x, y); track(x + w, y + h);
      }
      continue;
    }

    // ----- CIRCLE -----
    if (cmd === "CIRCLE") {
      // CIRCLE Normal cx cy r
      const cx = NUM(parts[2]);
      const cy = NUM(parts[3]);
      const r = NUM(parts[4]);
      if (![cx, cy, r].some((n) => isNaN(n))) {
        out.shapes.push({ type: "circle", cx, cy, r });
        track(cx - r, cy - r); track(cx + r, cy + r);
      }
      continue;
    }

    // ----- ARC -----
    if (cmd === "ARC") {
      const arc = arcFromPointsOrAngles(parts);
      if (!isNaN(arc.cx) && !isNaN(arc.cy) && !isNaN(arc.r)) {
        out.shapes.push({ type: "arc", ...arc });
        track(arc.cx - arc.r, arc.cy - arc.r);
        track(arc.cx + arc.r, arc.cy + arc.r);
      }
      continue;
    }

    // ----- POLYLINE -----
    if (cmd === "POLYLINE") {
      // POLYLINE Normal n x1 y1 x2 y2 ...
      const n = NUM(parts[3]);
      const coords = parts.slice(4).map(NUM);
      const pts = [];
      for (let i = 0; i < Math.min(n * 2, coords.length); i += 2) {
        const px = coords[i], py = coords[i + 1];
        if (!isNaN(px) && !isNaN(py)) {
          pts.push({ x: px, y: py });
          track(px, py);
        }
      }
      if (pts.length >= 2) out.shapes.push({ type: "polyline", points: pts });
      continue;
    }

    // ----- TEXT -----
    if (cmd === "TEXT") {
      // TEXT x y Align Size ;payload
      const x = NUM(parts[1]);
      const y = NUM(parts[2]);
      const align = parts[3] || "Left";
      const size = NUM(parts[4] || "12");
      const textValue = parseTextPayload(raw);
      if (!isNaN(x) && !isNaN(y)) {
        out.texts.push({ x, y, size: isNaN(size) ? 12 : size, align, text: textValue });
        track(x, y);
      }
      continue;
    }

    // ----- PIN -----
    if (cmd === "PIN") {
      // PIN x y Orientation [Len]
      const x = NUM(parts[1]);
      const y = NUM(parts[2]);
      const orientation = parts[3] || "Right";
      if (!isNaN(x) && !isNaN(y)) {
        out.pins.push({
          id: `P${out.pins.length + 1}`,
          name: "",
          x,
          y,
          orientation,
        });
        track(x, y);
      }
      continue;
    }

    // ----- PINATTR PinName XXX -----
    if (cmd === "PINATTR" && parts[1] === "PinName") {
      const p = lastPin();
      if (p) p.name = parts.slice(2).join(" ");
      continue;
    }

    // ----- SYMATTR Prefix X -----
    if (cmd === "SYMATTR" && parts[1] === "Prefix") {
      out.prefix = parts[2] || null;
      continue;
    }

    // 그 외 SYMATTR (Value, SpiceLine 등) 필요 시 확장 가능
  }

  // --- bbox 확정 + 정규화 ---
  const w = Math.max(1, out.bbox.x2 - out.bbox.x1);
  const h = Math.max(1, out.bbox.y2 - out.bbox.y1);
  const ox = isFinite(out.bbox.x1) ? out.bbox.x1 : 0;
  const oy = isFinite(out.bbox.y1) ? out.bbox.y1 : 0;

  const normX = (x) => x - ox;
  const normY = (y) => y - oy;

  out.shapes = out.shapes.map((s) => {
    if (s.type === "line")
      return { ...s, x1: normX(s.x1), y1: normY(s.y1), x2: normX(s.x2), y2: normY(s.y2) };
    if (s.type === "rect")
      return { ...s, x: normX(s.x), y: normY(s.y) };
    if (s.type === "circle")
      return { ...s, cx: normX(s.cx), cy: normY(s.cy) };
    if (s.type === "arc")
      return {
        ...s,
        cx: normX(s.cx), cy: normY(s.cy),
        ...(s.mode === "points"
          ? { x1: normX(s.x1), y1: normY(s.y1), x2: normX(s.x2), y2: normY(s.y2) }
          : {}),
      };
    if (s.type === "polyline")
      return { ...s, points: s.points.map((p) => ({ x: normX(p.x), y: normY(p.y) })) };
    return s;
  });

  out.texts = out.texts.map((t) => ({ ...t, x: normX(t.x), y: normY(t.y) }));
  out.pins  = out.pins.map((p) => ({ ...p, x: normX(p.x), y: normY(p.y) }));

  out.w = w;
  out.h = h;

  // --- prefix 기반 type 추론 추가 ---
  out.type = typeFromPrefix(out.prefix, out.pins.length);

  return out;
}
