import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

// ================== CONFIG ==================
const DATA_DIR = "data";
const EMBEDDINGS_FILE = path.join(DATA_DIR, "embeddings.json");
const PAGES_STATE_FILE = path.join(DATA_DIR, "pages_state.json");
const CHUNKS_STATE_FILE = path.join(DATA_DIR, "chunks_state.json");
const INDEX_DIR = path.join(DATA_DIR, "hnswlib");
const SSS_JSON_FILE = path.join(DATA_DIR, "sss.json");

// Quota-safe
const MAX_EMBEDS_PER_RUN = 200;
const DELAY_MS = 1200;

// Chunk parametreleri
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

// ================== HELPERS ==================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
}

function loadSssJson(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`sss.json bulunamadı: ${jsonPath}`);
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");

  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("sss.json bir dizi (array) olmalıdır.");
    }

    return parsed;
  } catch (err) {
    throw new Error(`sss.json parse edilemedi: ${err.message}`);
  }
}

function buildSssPageContent(item) {
  const linksText =
    Array.isArray(item.links) && item.links.length > 0
      ? item.links.map((l) => `- ${l.label}: ${l.url}`).join("\n")
      : "Yok";

  const keywordsText =
    Array.isArray(item.keywords) && item.keywords.length > 0
      ? item.keywords.join(", ")
      : "";

  return `
Kategori: ${item.category || ""}
Soru: ${item.question || ""}
Cevap: ${item.answer || ""}
Anahtar kelimeler: ${keywordsText}
Yönlendirmeler:
${linksText}
`.trim();
}

async function getVectorStore(embeddingsModel) {
  const indexFilesExist =
    fs.existsSync(path.join(INDEX_DIR, "args.json")) &&
    fs.existsSync(path.join(INDEX_DIR, "docstore.json")) &&
    fs.existsSync(path.join(INDEX_DIR, "hnswlib.index"));

  if (indexFilesExist) {
    return await HNSWLib.load(INDEX_DIR, embeddingsModel);
  }

  return new HNSWLib(embeddingsModel, { space: "cosine" });
}

// ================== PIPELINE ==================
async function main() {
  ensureDataDir();

  const pagesState = readJson(PAGES_STATE_FILE, {});
  const chunksState = readJson(CHUNKS_STATE_FILE, {});
  const embeddingsArr = readJson(EMBEDDINGS_FILE, []);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  const embeddingsModel = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "models/gemini-embedding-001",
  });

  const vectorStore = await getVectorStore(embeddingsModel);

  let embedsDone = 0;
  let chunksAdded = 0;
  let sssSkippedSameHash = 0;

  try {
    const sssItems = loadSssJson(SSS_JSON_FILE);

    for (const item of sssItems) {
      if (embedsDone >= MAX_EMBEDS_PER_RUN) break;

      const sourceId = `sss_json:${item.id}`;
      const pageContent = buildSssPageContent(item);
      const itemHash = sha256(JSON.stringify(item));

      if (pagesState[sourceId] && pagesState[sourceId] === itemHash) {
        sssSkippedSameHash++;
        continue;
      }

      const docs = await splitter.createDocuments(
        [pageContent],
        [
          {
            source: sourceId,
            source_type: "sss_json",
            file: "sss.json",
            id: item.id,
            category: item.category || "",
            question: item.question || "",
            links: Array.isArray(item.links) ? item.links : [],
            keywords: Array.isArray(item.keywords) ? item.keywords : [],
          },
        ]
      );

      for (let i = 0; i < docs.length; i++) {
        if (embedsDone >= MAX_EMBEDS_PER_RUN) break;

        const d = docs[i];
        const chunkText = String(d.pageContent || "").trim();
        if (!chunkText || chunkText.length < 40) continue;

        const chunkHash = sha256(`${sourceId}::${chunkText}`);
        if (chunksState[chunkHash]) continue;

        await sleep(DELAY_MS);

        const vec = await embeddingsModel.embedQuery(chunkText);
        embedsDone++;

        const chunk_id = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        embeddingsArr.push({
          text: chunkText,
          embedding: vec,
          source: sourceId,
          chunk_id,
          source_type: "sss_json",
          file: "sss.json",
          id: item.id,
          category: item.category || "",
          question: item.question || "",
          links: Array.isArray(item.links) ? item.links : [],
          keywords: Array.isArray(item.keywords) ? item.keywords : [],
        });

        chunksState[chunkHash] = {
          source: sourceId,
          chunk_id,
        };

        await vectorStore.addVectors(
          [vec],
          [
            new Document({
              pageContent: chunkText,
              metadata: {
                source: sourceId,
                chunk_id,
                source_type: "sss_json",
                file: "sss.json",
                id: item.id,
                category: item.category || "",
                question: item.question || "",
                links: Array.isArray(item.links) ? item.links : [],
                keywords: Array.isArray(item.keywords) ? item.keywords : [],
              },
            }),
          ]
        );

        chunksAdded++;
      }

      pagesState[sourceId] = itemHash;
    }

    writeJson(EMBEDDINGS_FILE, embeddingsArr);
    writeJson(PAGES_STATE_FILE, pagesState);
    writeJson(CHUNKS_STATE_FILE, chunksState);

    fs.mkdirSync(INDEX_DIR, { recursive: true });
    await vectorStore.save(INDEX_DIR);

    console.log("\n==============================");
    console.log("Pipeline bitti");
    console.log("Bu koşuda embed edilen chunk:", embedsDone);
    console.log("Index'e eklenen yeni chunk:", chunksAdded);
    console.log("SSS skip (same hash):", sssSkippedSameHash);
    console.log("Embeddings total:", embeddingsArr.length);
    console.log("Index dir:", INDEX_DIR);
    console.log("==============================\n");
  } catch (err) {
    throw err;
  }
}

main().catch((err) => {
  console.error("Pipeline hata:", err);
  process.exit(1);
});