import "dotenv/config";
import express from "express";
import cors from "cors";
import { answerQuestion } from "./rag.mjs";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required" });

    const out = await answerQuestion(message);
    res.json(out);
  } catch (err) {
    console.error("API error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.listen(PORT, () => {
  console.log(`API running: http://localhost:${PORT}`);
});