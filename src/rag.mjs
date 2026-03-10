import "dotenv/config";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const INDEX_DIR = "data/hnswlib";

const CONTACT_FALLBACK = {
  answer:
    "Bu konuda elimde net bir bilgi bulunmuyor. En doğru bilgi için Edirne Belediyesi iletişim kanallarını kullanabilirsiniz. Detaylara buraya tıklayarak ulaşabilirsiniz.",
  links: [
    {
      label: "İletişim için buraya tıklayın",
      url: "https://edirne.bel.tr/home/iletisim",
    },
  ],
};

const OUT_OF_SCOPE_ANSWER =
  "Bu konuda yardımcı olamam. Ben yalnızca Edirne Belediyesi hizmetleri, başvurular, iletişim ve belediye işlemleriyle ilgili soruları yanıtlamak için tasarlandım.";

// ---------------- HELPERS ----------------
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildContext(docs) {
  return docs
    .map((d, i) => {
      const src = d.metadata?.source ?? "unknown_source";
      const chunk = d.metadata?.chunk_id ?? "na";
      const category = d.metadata?.category ?? "";
      const question = d.metadata?.question ?? "";
      const text = String(d.pageContent || "").replace(/\s+/g, " ").trim();

      return [
        `Parça ${i + 1}`,
        `(source=${src}, chunk_id=${chunk}, category=${category})`,
        question ? `Soru: ${question}` : "",
        text,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function uniqueSources(docs, max = 2) {
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

function bestLinksFromTopDoc(docs, max = 1) {
  if (!Array.isArray(docs) || docs.length === 0) return [];

  const topDoc = docs[0];
  const links = Array.isArray(topDoc.metadata?.links)
    ? topDoc.metadata.links
    : [];

  return links
    .filter((link) => link?.url && link?.label)
    .slice(0, max)
    .map((link) => ({
      label: link.label,
      url: link.url,
    }));
}

function isLikelyMunicipalityQuestion(message) {
  const text = normalizeText(message);

  const municipalityKeywords = [
    "belediye",
    "edirne",
    "kentkart",
    "kent kart",
    "kent kartı",
    "ulaşım kartı",
    "otobüs kartı",
    "etus",
    "nikah",
    "nikâh",
    "evlendirme",
    "emlak",
    "vergi",
    "çevre temizlik",
    "ilan reklam",
    "su aboneli",
    "su fatur",
    "abonelik",
    "askıda fatura",
    "sosyal yardım",
    "alo 153",
    "otopark",
    "imar",
    "iskan",
    "yapı kullanma",
    "ruhsat",
    "cenaze",
    "defin",
    "mezarlık",
    "erişilebilirlik",
    "bize yazın",
    "e-devlet",
    "e-belediye",
    "ebelediye",
    "iletişim",
    "adres",
    "telefon",
    "mail",
    "e-posta",
    "fatura",
    "başvuru",
    "belge",
    "pazar",
    "pazar yeri",
    "pazaryeri",
    "eczane",
    "nöbetçi eczane",
    "yeşil edirne",
    "bağış",
    "toplu taşıma",
    "durak",
    "güzergah",
    "muhtar",
    "kırkpınar",
    "duyuru",
    "kültür",
    "turizm",
    "gezilecek",
  ];

  return municipalityKeywords.some((kw) => text.includes(kw));
}

function hasUsableDocs(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return false;

  const totalLength = docs.reduce(
    (sum, d) => sum + String(d.pageContent || "").trim().length,
    0
  );

  return totalLength >= 60;
}

function prioritizeDocs(message, docs) {
  const text = normalizeText(message);

  const scored = docs.map((doc) => {
    let score = 0;

    const category = normalizeText(doc.metadata?.category || "");
    const question = normalizeText(doc.metadata?.question || "");
    const content = normalizeText(doc.pageContent || "");
    const sourceType = normalizeText(doc.metadata?.source_type || "");

    if (sourceType === "sss_json") score += 10;

    // İletişim
    if (/iletişim|telefon|mail|e-?posta|adres|alo\s*153/.test(text)) {
      if (category.includes("iletisim")) score += 10;
      if (question.includes("iletişim")) score += 6;
    }

    // Ulaşım / KentKart
    if (/kentkart|kent kart|kent kartı|etus|ulaşım kartı|otobüs kartı/.test(text)) {
      if (category.includes("ulasim")) score += 10;
      if (question.includes("kentkart") || question.includes("kent kart")) score += 6;
    }

    // Nikah
    if (/nikah|nikâh|evlendirme/.test(text)) {
      if (category.includes("nikah")) score += 10;
      if (question.includes("nik")) score += 6;
    }

    // Vergi
    if (/emlak|vergi|çevre temizlik|ilan reklam/.test(text)) {
      if (category.includes("vergi")) score += 10;
    }

    // Su Hizmetleri
    if (/su aboneli|su fatur|abonelik|kanalizasyon/.test(text)) {
      if (category.includes("su_hizmetleri")) score += 10;
    }

    // Sosyal Yardım
    if (/askıda fatura|fatura yardımı|sosyal yardım|yardım başvuru|destek/.test(text)) {
      if (category.includes("sosyal_yardim")) score += 10;
    }

    // Otopark
    if (/otopark/.test(text)) {
      if (category.includes("otopark")) score += 10;
    }

    // Cenaze
    if (/cenaze|defin|ölüm belgesi|mezarlık/.test(text)) {
      if (category.includes("cenaze")) score += 10;
    }

    // İmar
    if (/imar|iskan|yapı kullanma|ruhsat/.test(text)) {
      if (category.includes("imar")) score += 10;
    }

    // Pazar yerleri
    if (/pazar|pazaryeri|pazar yeri/.test(text)) {
      if (category.includes("pazar")) score += 10;
    }

    // Eczane
    if (/eczane|nöbetçi/.test(text)) {
      if (category.includes("saglik")) score += 10;
    }

    // Kültür & Turizm
    if (/kültür|turizm|gezilecek|kırkpınar/.test(text)) {
      if (category.includes("kultur")) score += 8;
    }

    // Duyuru
    if (/duyuru|gündem/.test(text)) {
      if (category.includes("duyuru")) score += 8;
    }

    // Bağış
    if (/bağış|yeşil edirne/.test(text)) {
      if (category.includes("bagis")) score += 8;
    }

    // Muhtar
    if (/muhtar/.test(text)) {
      if (category.includes("muhtar")) score += 8;
    }

    // Anahtar kelimeler
    const keywords = Array.isArray(doc.metadata?.keywords)
      ? doc.metadata.keywords.map((k) => normalizeText(k))
      : [];

    for (const kw of keywords) {
      if (kw && text.includes(kw)) score += 4;
    }

    if (question && text.includes(question)) score += 5;
    if (question && question.includes(text)) score += 3;
    if (content && content.includes(text)) score += 2;

    return { doc, score };
  });

  return scored.sort((a, b) => b.score - a.score).map((x) => x.doc);
}

// ---------------- SINGLETONS ----------------
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

const system = new SystemMessage(`
Sen Edirne Belediyesi dijital asistanısın.

Kurallar:
1. Yalnızca verilen BAĞLAM'a göre cevap ver.
2. Cevap kısa, net ve vatandaş odaklı olsun.
3. BAĞLAM içinde bilgi varsa onu özetle.
4. BAĞLAM içinde olmayan bilgiyi ASLA uydurma.
5. BAĞLAM yetersizse tam olarak şu cümleyi kullan:
   "Bu konuda elimde net bir bilgi bulunmuyor. En doğru bilgi için Edirne Belediyesi iletişim kanallarını kullanabilirsiniz."
6. Kullanıcının sorusu Edirne Belediyesi ile alakasızsa tam olarak şu cümleyi kullan:
   "Bu konuda yardımcı olamam. Ben yalnızca Edirne Belediyesi hizmetleri, başvurular, iletişim ve belediye işlemleriyle ilgili soruları yanıtlamak için tasarlandım."
7. Cevabın içine ham URL yazma.
8. "Kaynak:" veya "Link:" başlığı açma.
9. Cevap sonunda "buraya tıklayarak ulaşabilirsiniz" gibi doğal bir yönlendirme ifadesi kullanabilirsin, ama linki metne yazma.
10. Sadece düz metin cevap üret.
`);

function shouldSuggestClickSentence(links, answer) {
  if (!Array.isArray(links) || links.length === 0) return false;

  const normalized = normalizeText(answer);
  return !normalized.includes("buraya tıklayarak ulaşabilirsiniz");
}

export async function answerQuestion(message) {
  const cleanMessage = String(message || "").trim();

  if (!cleanMessage) {
    return {
      answer: "Lütfen belediye hizmetleriyle ilgili bir soru yazın.",
      sources: [],
      links: [],
    };
  }

  if (!isLikelyMunicipalityQuestion(cleanMessage)) {
    return {
      answer: OUT_OF_SCOPE_ANSWER,
      sources: [],
      links: [],
    };
  }

  const vectorStore = await getVectorStore();
  const retriever = vectorStore.asRetriever({ k: 8 });

  let docs = await retriever.invoke(cleanMessage);
  docs = prioritizeDocs(cleanMessage, docs).slice(0, 5);

  if (!hasUsableDocs(docs)) {
    return {
      answer: CONTACT_FALLBACK.answer,
      sources: [],
      links: CONTACT_FALLBACK.links,
    };
  }

  const context = buildContext(docs);
  const user = new HumanMessage(`Soru: ${cleanMessage}\n\nBAĞLAM:\n${context}`);
  const res = await llm.invoke([system, user]);

  let answer = String(res.content || "").trim();
  const sources = uniqueSources(docs, 2);
  const links = bestLinksFromTopDoc(docs, 1);
  const normalized = normalizeText(answer);

  if (
    normalized.includes("bu konuda elimde net bir bilgi bulunmuyor") ||
    normalized.includes("bu bilgi kaynaklarda bulunamadı")
  ) {
    return {
      answer: CONTACT_FALLBACK.answer,
      sources,
      links: CONTACT_FALLBACK.links,
    };
  }

  if (normalized.includes("yalnızca edirne belediyesi")) {
    return {
      answer: OUT_OF_SCOPE_ANSWER,
      sources: [],
      links: [],
    };
  }

  if (shouldSuggestClickSentence(links, answer)) {
    answer = `${answer} Detaylara buraya tıklayarak ulaşabilirsiniz.`;
  }

  return {
    answer,
    sources,
    links,
  };
}