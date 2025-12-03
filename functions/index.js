import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import fetch from "node-fetch";
import corsLib from "cors";

const cors = corsLib({ origin: true });

// Secret
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

export const generateCircuit = onRequest(
  {
    region: "us-central1",
    secrets: [OPENAI_API_KEY],
  },
  (req, res) => {
    cors(req, res, async () => {
      try {
        // -------------------------------
        // 🔥 JSON 안전 파싱
        // -------------------------------
        let body = req.body;

        // rawBody가 존재하면 → JSON으로 파싱
        if (!body && req.rawBody) {
          try {
            body = JSON.parse(req.rawBody.toString());
          } catch (e) {
            throw new Error("❌ Failed to parse rawBody JSON");
          }
        }

        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch (e) {
            throw new Error("❌ Failed to parse body JSON");
          }
        }

        const { userPrompt, systemPrompt } = body || {};

        if (!userPrompt || !systemPrompt) {
          throw new Error("❌ Missing userPrompt or systemPrompt");
        }

        const apiKey = OPENAI_API_KEY.value();
        if (!apiKey) throw new Error("❌ Missing OPENAI_API_KEY");

        logger.info("📥 userPrompt:", userPrompt);
        logger.info("📥 systemPrompt:", systemPrompt);

        // -------------------------------
        // 🔥 OpenAI API 호출
        // -------------------------------
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              temperature: 0,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || "OpenAI API error");
        }

        res.set("Access-Control-Allow-Origin", "*");
        res.status(200).send(data);

      } catch (err) {
        logger.error("🔥 Error:", err);
        res.set("Access-Control-Allow-Origin", "*");
        res.status(500).send({ error: err.message });
      }
    });
  }
);
