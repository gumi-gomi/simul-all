// ================================
// Firebase Functions를 통한 GPT 호출
// ================================
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebaseConfig";

const functions = getFunctions(app);

/**
 * GPT 호출: systemPrompt + userPrompt 모두 보냄
 */
export async function callAI(userPrompt, systemPrompt) {
  try {
    const res = await fetch(
      "https://us-central1-elechub-gpt.cloudfunctions.net/generateCircuit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userPrompt,
          systemPrompt, // 🔥 system 프롬프트 전달!
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    return data; // { choices: [...] }
  } catch (err) {
    console.error("🔥 Firebase Function 호출 실패:", err);
    return null;
  }
}

// ================================================
// (테스트용) 브라우저에서 직접 OpenAI API 호출
// ================================================
export async function generateCircuit(prompt) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an AI assistant.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("❌ OpenAI API 호출 실패:", err);
    return null;
  }
}
