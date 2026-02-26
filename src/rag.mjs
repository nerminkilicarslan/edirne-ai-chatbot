import "dotenv/config";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const INDEX_DIR = "data/hnswlib";

// ---- Helpers
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

function uniqueSources(docs, max = 8) {
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

// ---- Singletons 
let vectorStorePromise = null;

async function getVectorStore() {
  if (!vectorStorePromise) {
    const embeddingsModel = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GOOGLE_API_KEY,
      model: "models/gemini-embedding-001",
    });
    vectorStorePromise = HNSWLib.load(INDEX_DIR, embeddingsModel);
  }
  return vectorStorePromise;
}

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
Cevabın sonunda kaynak linklerini yazma; kaynakları API ayrı döndürecek.`
);

export async function answerQuestion(message) {
  const vectorStore = await getVectorStore();


  const retriever = vectorStore.asRetriever({ k: 6 });

  let docs = await retriever.invoke(message);

  if (/iletişim|telefon|mail|e-?posta|adres|alo\s*153/i.test(message)) {
    const contact = docs.find(d => String(d.metadata?.source || "").includes("/home/iletisim"));
    if (contact) docs = [contact, ...docs.filter(x => x !== contact)];
  }

  const context = buildContext(docs);
  const user = new HumanMessage(`Soru: ${message}\n\nBAĞLAM:\n${context}`);

  const res = await llm.invoke([system, user]);
  const sources = uniqueSources(docs);

  return { answer: String(res.content || ""), sources };
}