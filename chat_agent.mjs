import "dotenv/config";
import readline from "readline";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const INDEX_DIR = "data/hnswlib";

function buildContext(docs) {
  return docs
    .map((d, i) => {
      const src = d.metadata?.source ?? "unknown_source";
      const chunk = d.metadata?.chunk_id ?? "na";
      const text = (d.pageContent || "").replace(/\s+/g, " ").trim();
      return `Parça ${i + 1} (source=${src}, chunk_id=${chunk}):\n${text}`;
    })
    .join("\n\n---\n\n");
}

function uniqueSources(docs, max = 3) {
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    const s = d.metadata?.source;
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= max) break;
    }
  }
  return out;
}

async function main() {
  const embeddingsModel = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "models/gemini-embedding-001",
  });

  const vectorStore = await HNSWLib.load(INDEX_DIR, embeddingsModel);

  const retriever = vectorStore.asRetriever({ k: 4 });

  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "models/gemini-flash-lite-latest",
    temperature: 0,
  });

  const system = new SystemMessage(
`Sen Edirne Belediyesi için çalışan bir asistansın.
KURAL: Sadece verilen BAĞLAM'a göre cevap ver.
BAĞLAM'da yoksa: "Bu bilgi kaynaklarda bulunamadı." de.
Tahmin etme, uydurma, genel bilgi kullanma.
Kaynak yazma. Kaynakları ben ayrı göstereceğim.`
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () =>
    rl.question("\nSoru: ", async (q) => {
      const q2 = /tesis/i.test(q) ? `${q} Edirne Belediyesi belediye tesisler` : q;

      let docs = await retriever.invoke(q);

      if (/iletişim|telefon|mail|e-?posta|adres/i.test(q)) {

        const iletişimDoc = docs.find(d =>
          String(d.metadata?.source).includes("/home/iletisim")
        );

        if (iletişimDoc) {
          docs = [
            iletişimDoc,
            ...docs.filter(d => d !== iletişimDoc)
          ];
        }
      }

      const context = buildContext(docs);
      const sources = uniqueSources(docs, 3);

      const user = new HumanMessage(`Soru: ${q}\n\nBAĞLAM:\n${context}`);
      const res = await llm.invoke([system, user]);

      console.log("\nCevap:\n", res.content);

      console.log("\nKaynaklar:");
      sources.forEach((s) => console.log("-", s));

      ask();
    });

  ask();
}

main().catch((err) => {
  console.error("Hata:", err);
  process.exit(1);
});