import React, { useState, useRef, useEffect } from "react";
import { callAI } from "../api/gptService";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// GPT가 사용할 심볼 목록 (DRAW_LIB → rebuildGPTLib()로 동기화됨)
// import { GPT_LIB as LIB } from "../simulator/gptLib";

/* ===========================
   Markdown
=========================== */
function MarkdownMessage({ text }) {
  if (!text) return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{children}</p>
        ),
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          if (!inline) {
            return (
              <SyntaxHighlighter
                style={oneDark}
                language={match?.[1] || "text"}
                PreTag="div"
                customStyle={{
                  margin: "6px 0",
                  borderRadius: 6,
                  fontSize: 13,
                }}
                {...props}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          }
          return (
            <code
              style={{
                background: "rgba(0,0,0,0.1)",
                padding: "2px 4px",
                borderRadius: 4,
              }}
              {...props}
            >
              {children}
            </code>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/* ===========================
   Typing dots
=========================== */
function TypingDots() {
  return (
    <span className="typing-dots">
      <span className="dot"></span>
      <span className="dot"></span>
      <span className="dot"></span>
    </span>
  );
}

/* ======================================================
   Main ChatPanel
====================================================== */
export default function ChatPanel({ onCircuitGenerated, gptLib }) {
  const [prompt, setPrompt] = useState("");
  const [conversation, setConversation] = useState([]);
  const [typingResponse, setTypingResponse] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  const textareaRef = useRef(null);
  const messagesRef = useRef(null);

  const MAX_INPUT_HEIGHT = 100;

  /* textarea auto resize */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const newH = Math.min(ta.scrollHeight, MAX_INPUT_HEIGHT);
    ta.style.height = newH + "px";
    ta.style.overflowY = ta.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [prompt]);

  /* auto scroll */
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [conversation, typingResponse]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /* =====================================================
     buildSystemPrompt = 최신 GPT_LIB 기반으로 매번 생성
  ====================================================== */
 const buildSystemPrompt = () => {
    const symbolList = JSON.stringify(gptLib, null, 2);

    const portRules = Object.entries(gptLib).map(([key, def]) => {
        const ports = def.ports.map(p => `"${p}"`).join(", ");
        return `- ${key}: ports → ${ports}`;
    }).join("\n");


    return `

당신은 “AI Circuit Architect”이며, 사용자의 자연어 요청을 분석하고
전자공학의 보편적 원리에 따라 ElecHub 시뮬레이터용 JSON 회로를 생성해야 한다.

============================================================
🔵 1) Universal Circuit Principles (항상 적용되는 보편 규칙만 포함)

1. Ground & Reference Rule
- 회로 전체는 하나의 기준 노드(GND1)를 가진다.
- 모든 vsource의 "-"는 반드시 GND1.GND에 연결한다.
- floating node(반환 경로 없는 노드)는 존재할 수 없다.

2. Energy & Current Path Rule
- 모든 회로는 “공급 → 기능 블록 → 출력/부하 → GND”의 닫힌 루프를 가져야 한다.
- 인덕터는 전류 연속성을 유지하려 하고,
  커패시터는 전압 연속성을 유지하려 한다.

3. Passive Two-Terminal Rule
- resistor, capacitor, capacitor_polarized, inductor는 항상 2단자 요소이다.
- capacitor_polarized는 반드시 "+"와 "-" 포트만 사용한다.
- "+"는 더 높은 전위, "-"는 항상 더 낮은 전위(GND 방향)에 연결된다.

4. Diode Direction Rule
- 다이오드는 높은 전위(K)에서 낮은 전위(A) 방향으로 전류를 통과하지 않는다.
- 배치는 항상 A → K 방향으로 전류가 흐르도록 구성해야 한다.

5. MOSFET Rule
- mosfet은 type="mosfet"만 사용한다 (nmos/pmos 별칭 금지).
- 포트는 D/G/S만 사용한다.
- Gate는 반드시 회로적 의미가 있는 노드에 연결되며,
  절대 floating 상태가 되어서는 안 된다.

6. Transformer Rule
- transformer는 P_A/P_B가 1차, S_A/S_B가 2차이다.
- 갈바닉 절연이 있으므로 1차와 2차는 직접 연결될 수 없다.

7. SPICE Validity Rule
- 모든 노드는 최소 하나 이상의 경로로 GND1과 연결되어야 한다.
- 출력 노드에 DC vsource를 직접 연결하면 안 된다.

============================================================
🔵 2) 사용 가능 소자 및 포트 정의
(런타임에서 ${symbolList}, ${portRules}로 제공되는 값만 허용한다)

- 존재하지 않는 type/port는 절대 생성 금지.
- components 내부에 포트명을 넣지 말고,
  모든 배선은 connections 배열에서만 정의한다.

============================================================
🔵 3) JSON 스키마 (ElecHub 전용)

반드시 아래 형태만 출력한다:

{
  "components": [
    { "id": "GND1", "type": "ground" },
    { "id": "V1", "type": "vsource", "waveType": "DC", "dc": "12" }
  ],
  "connections": [
    { "from": "V1.-", "to": "GND1.GND" }
  ]
}

제약:
- type은 소문자
- capacitor_polarized는 "+" / "-"만 사용 ("1/2" 금지)
- MOSFET type은 "mosfet"만 허용
- draw/w/h/style 등 불필요한 필드 금지
- JSON 외 텍스트는 code block 내부에 넣지 않는다

============================================================
🔵 4) 출력 전 자동 자체검증 (위반 시 JSON만 재작성)

1) 모든 vsource "-" → GND1.GND 여부  
2) 모든 포트명 존재 여부  
3) capacitor_polarized 포트가 "+/-"인지  
4) MOSFET type이 규격(type="mosfet")인지  
5) floating node 존재 여부  
6) 출력 노드에 DC 소스 직접 연결 여부  
7) JSON 문법 오류 여부

============================================================
이 프롬프트는 특정 토폴로지를 강제하지 않는다.
사용자의 요청을 기반으로 “보편 회로 원리”만 적용하여 토폴로지를 스스로 추론해야 한다.
    
`;
  };

  /* ======================================================
     handleSubmit
  ======================================================= */
  const handleSubmit = async () => {
    if (!prompt.trim() || isThinking) return;

    const userText = prompt;
    setPrompt("");
    setTypingResponse("");
    setIsThinking(true);

    setConversation((prev) => [...prev, { prompt: userText, response: "" }]);

    let result = "";

    try {
      const data = await callAI(userText, buildSystemPrompt());
      result = data?.choices?.[0]?.message?.content || "결과 없음";
    } catch {
      result = "❌ GPT 호출 오류";
    }

    // typing effect
    let acc = "";
    [...result].forEach((ch, i) => {
      setTimeout(() => {
        acc += ch;
        setTypingResponse(acc);
      }, i * 8);
    });

    // apply after typing
    setTimeout(() => {
      setConversation((prev) => {
        const cp = [...prev];
        cp[cp.length - 1].response = result;
        return cp;
      });

      // JSON 파싱
      try {
        const match = result.match(/```json([\s\S]*?)```/);
        if (match) {
          const circuit = JSON.parse(match[1].trim());
          onCircuitGenerated?.(circuit);
        }
      } catch {}

      setIsThinking(false);
    }, result.length * 8 + 100);
  };

  /* ======================================================
     UI 렌더링
  ======================================================= */
  const typingCss = `
    .typing-dots { display:inline-flex; gap:4px; }
    .dot { width:6px; height:6px; border-radius:50%; background:#666;
      animation: blink 1s infinite ease-in-out; }
    .dot:nth-child(2){ animation-delay:0.2s; }
    .dot:nth-child(3){ animation-delay:0.4s; }
    @keyframes blink {
      0%,100%{ opacity:0.2; transform:translateY(0); }
      50%{ opacity:1; transform:translateY(-1px); }
    }
  `;

  return (
    <div
      style={{
        width: "100%",
        height: 650,
        maxWidth: 1340,
        margin: "0 auto",
        borderRadius: 12,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{typingCss}</style>

      <div
        style={{
          padding: "14px 18px",
          fontWeight: 700,
          fontSize: 20,
          background: "#f0f0f0ff",
        }}
      >
        ElecHub AI
      </div>

      <div
        ref={messagesRef}
        style={{
          flex: 1,
          padding: "16px",
          overflowY: "auto",
          background: "#ffffff",
        }}
      >
        {conversation.map((item, idx) => {
          const isLast = idx === conversation.length - 1;
          const reply = isLast ? typingResponse || item.response : item.response;
          const showTyping = isLast && isThinking && !typingResponse;

          return (
            <div key={idx} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div
                  style={{
                    maxWidth: "70%",
                    background: "#007bff",
                    padding: "10px 14px",
                    color: "#fff",
                    borderRadius: "16px 16px 4px 16px",
                    fontSize: 15,
                    lineHeight: 1.5,
                  }}
                >
                  {item.prompt}
                </div>
              </div>

              <div style={{ display: "flex", marginTop: 10 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg,#55aaff,#0066ff)",
                    marginRight: 10,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  E
                </div>

                <div
                  style={{
                    maxWidth: "70%",
                    background: "#fff",
                    padding: "10px 14px",
                    borderRadius: "16px",
                    border: "1px solid rgba(0,0,0,0.08)",
                    fontSize: 15,
                    lineHeight: 1.6,
                  }}
                >
                  {showTyping ? <TypingDots /> : <MarkdownMessage text={reply} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        style={{
          padding: "16px",
          background: "#ffffff",
          borderTop: "1px solid rgba(0,0,0,0.03)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 12,
            padding: "12px",
            gap: 10,
            boxShadow: "2px 2px 5px rgba(0,0,0,0.07)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요"
            rows={1}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 15,
              background: "transparent",
              resize: "none",
              lineHeight: 1.3,
            }}
          />

          <button
            type="submit"
            disabled={isThinking}
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: isThinking ? "#bbb" : "#007bff",
              color: "#fff",
              border: "none",
              fontSize: 17,
              cursor: isThinking ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            }}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
