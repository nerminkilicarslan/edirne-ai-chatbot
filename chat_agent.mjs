import "dotenv/config";
import readline from "readline";
import { answerQuestion } from "./src/rag.mjs";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () =>
    rl.question("\nSoru: ", async (q) => {
      try {
        const result = await answerQuestion(q);

        console.log("\nCevap:\n", result.answer || "");

        if (Array.isArray(result.links) && result.links.length > 0) {
          console.log("\nButonlar:");
          result.links.forEach((l) => {
            console.log(`- ${l.label}`);
          });
        }

        if (Array.isArray(result.sources) && result.sources.length > 0) {
          console.log("\nKaynaklar:");
          result.sources.forEach((s) => console.log("-", s));
        }
      } catch (err) {
        console.error("\nHata:", err?.message || err);
      }

      ask();
    });

  ask();
}

main().catch((err) => {
  console.error("Hata:", err);
  process.exit(1);
});