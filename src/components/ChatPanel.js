import React, { useState, useRef, useEffect } from "react";
import { callAI } from "../api/gptService";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// GPT가 사용할 심볼 목록 (DRAW_LIB → rebuildGPTLib()로 동기화됨)
import { GPT_LIB as LIB } from "../simulator/gptLib";

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
export default function ChatPanel({ onCircuitGenerated }) {
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
    const symbolList = JSON.stringify(LIB, null, 2);

    const portRules = Object.entries(LIB).map(([key, def]) => {
  const ports = def.ports.map(p => `"${p}"`).join(", ");
  return `- ${key}: ports → ${ports}`;
}).join("\n");

    return `
당신은 전자회로 설계 전문가 AI이지만,
⭐ 사용자가 회로를 요구하지 않는 경우에는 일반적인 대화도 정상적으로 답변해야 한다.

회로 요청일 때만 아래 규칙을 적용한다.

━━━━━━━━━━━━━━━━━━
📌 [현재 사용 가능한 소자 목록(LIB)]
${symbolList}

📌 [소자별 포트 규칙]
${portRules}
━━━━━━━━━━━━━━━━━━

📌 JSON은 반드시 컴포넌트의 실제 포트명(DRAW_LIB에서 로드된 포트명)을 그대로 사용해야 한다.
⚠️ 포트명(A,B,1,2,+,-,C,B,E 등)은 모두 LIB에서 제공된 실제 포트명만 사용한다.
    직접 다른 이름으로 바꾸면 안 된다.

📌 전원 규칙
- vsource의 "-" 포트는 반드시 ground의 "GND" 포트와 연결해야 한다.

📌 연결 예:
- "R1.1", "R1.2"        ←(resistor 예시. 실제 포트명에 따라 다름)
- "C1.A", "C1.B"        ←(capacitor 예시)
- "V1.+", "V1.-"
- "GND1.GND"
- "Q1.C", "Q1.B", "Q1.E"
- "M1.D", "M1.G", "M1.S"

━━━━━━━━━━━━━━━━━━

JSON 예시 (항상 아래 형식을 유지)

\`\`\`
json
{
  "components": [
    { "id": "R1", "type": "resistor", "value": "1k", "x": 200, "y": 200 },
    { "id": "V1", "type": "vsource", "waveType": "DC", "dc": "5" },
    { "id": "GND1", "type": "ground" }
  ],
  "connections": [
    { "from": "V1.+", "to": "R1.1" },
    { "from": "R1.2", "to": "GND1.GND" }
  ]
}
\`\`\`

📌 필수 연결 규칙 (아주 중요)
- 모든 vsource는 반드시 "-" 포트를 ground.GND와 직접 연결해야 한다.
  (예: { "from": "V1.-", "to": "GND1.GND" })

- vsource의 "-" 포트가 GND에 연결되지 않으면 회로 전체가 동작할 수 없으므로,
  이런 경우에는 잘못된 JSON을 만들지 말고 반드시 올바르게 연결된 형태의 JSON을 생성한다.


규칙:
1. 출력 JSON에서 component.type은 반드시 소문자.
2. JSON 이외의 설명도 가능하지만, JSON 출력 시 반드시 코드블록(\`\`\`json) 안에 넣는다.
3. 포트명은 반드시 LIB에서 제공한 실제 포트명만 사용한다.
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
