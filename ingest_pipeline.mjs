// ingest_pipeline.mjs
// Web sitesini crawl eder
// Sayfa içeriğini temizler
// Metni chunk’lara böler
// Sadece yeni/değişmiş chunk’ları embed eder (hash kontrolü)
// Gemini ile embedding üretir
// HNSWLib index’e ekler
// JSON state dosyaları ile tekrar embed etmeyi önler
// + SSS.docx'i de aynı index'e ekler (incremental)

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import * as cheerio from "cheerio";

import { chromium } from "playwright"; // /hizmet sayfaları için render
import mammoth from "mammoth"; // DOCX -> text

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

// ================== CONFIG ==================
const BASE_URL = "https://www.edirne.bel.tr";

const SEEDS = [
  `${BASE_URL}/`,
  `${BASE_URL}/home/iletisim`,
];

const DATA_DIR = "data";
const EMBEDDINGS_FILE = path.join(DATA_DIR, "embeddings.json");
const PAGES_STATE_FILE = path.join(DATA_DIR, "pages_state.json");
const CHUNKS_STATE_FILE = path.join(DATA_DIR, "chunks_state.json");
const INDEX_DIR = path.join(DATA_DIR, "hnswlib");

// ✅ DOCX dosyası (js/data/sss.docx)
const SSS_DOCX_FILE = path.join(DATA_DIR, "sss.docx");

// Quota-safe
const MAX_EMBEDS_PER_RUN = 200;
const DELAY_MS = 1200;

// Crawl limitleri
const MAX_PAGES = 120;
const MAX_DEPTH = 3;

// Chunk parametreleri
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_PAGE = 20;
const MAX_CHUNKS_PER_HIZMET_PAGE = 12;

// Allowlist
const ALLOWLIST = [
  /^https:\/\/www\.edirne\.bel\.tr\/$/i,
  /^https:\/\/www\.edirne\.bel\.tr\/(home|iletisim|hizmet|kurumsal|belediye|sss|e-belediye|e_belediye)(\/|$|\?)/i,
];

const SKIP_EXT = /\.(pdf|zip|rar|7z|jpg|jpeg|png|gif|webp|svg|mp4|mp3|doc|docx|xls|xlsx|ppt|pptx)$/i;

const SKIP_SUBSTR = [
  "mailto:",
  "javascript:",
  "/download",
  "wp-content",
  "gundem",
  "arsiv",
  "etiket",
  "tag=",
  "page=",
  "/kurumsal/viewer/",
  "/viewer/",
  "/hizmet/tarifedergi/",
];

// ================== HELPERS ==================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
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

function normalizeUrl(u) {
  try {
    const url = new URL(u, BASE_URL);
    url.hash = "";
    if (url.hostname === "edirne.bel.tr") url.hostname = "www.edirne.bel.tr";
    return url.toString();
  } catch {
    return null;
  }
}

function isAllowed(url) {
  if (!url.startsWith(BASE_URL)) return false;
  if (SKIP_EXT.test(url)) return false;
  if (SKIP_SUBSTR.some((x) => url.toLowerCase().includes(x))) return false;
  return ALLOWLIST.some((re) => re.test(url));
}

function extractCleanText(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, noscript, svg").remove();

  const main =
    $("main").first().text() ||
    $("article").first().text() ||
    $("#content").text() ||
    $(".content").first().text() ||
    $("body").text();

  let text = (main || "").replace(/\s+/g, " ").trim();
  text = text
    .replace(/Ana içeriğe atla/gi, " ")
    .replace(/Anasayfa/gi, " ")
    .replace(/☰/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function extractLinks(html, currentUrl) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = normalizeUrl(new URL(href, currentUrl).toString());
    if (abs) links.add(abs);
  });

  return [...links];
}

// ✅ DOCX -> raw text
async function loadDocxAsText(docxPath) {
  if (!fs.existsSync(docxPath)) return "";
  const result = await mammoth.extractRawText({ path: docxPath });
  return String(result.value || "").replace(/\s+/g, " ").trim();
}

// ✅ Dinamik /hizmet sayfaları için render fetch
async function fetchHtml(url, browser) {
  const isHizmet = url.includes("/hizmet?");
  if (!isHizmet) {
    const res = await axios.get(url, { timeout: 20000, maxRedirects: 5 });
    return String(res.data);
  }

  if (!browser) throw new Error("Playwright browser not initialized");

  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(800);
    return await page.content();
  } finally {
    await page.close();
  }
}

// ================== CRAWL ==================
async function crawl(browser) {
  const queue = [];
  const visited = new Set();

  for (const s of SEEDS) {
    const u = normalizeUrl(s);
    if (u && isAllowed(u)) queue.push({ url: u, depth: 0 });
  }

  const pages = [];
  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const html = await fetchHtml(url, browser);
      const text = extractCleanText(html);

      if (text && text.length > 200) {
        pages.push({ url, html, text });
      }

      if (depth < MAX_DEPTH) {
        const links = extractLinks(html, url);
        for (const link of links) {
          if (!visited.has(link) && isAllowed(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (e) {
      const status = e?.response?.status;
      console.warn("Fetch fail:", url, status ?? "", e?.message ?? "");
    }
  }

  return pages;
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

  // Vector index load/init
  let vectorStore = null;
  const indexExists = fs.existsSync(INDEX_DIR);
  if (indexExists) {
    vectorStore = await HNSWLib.load(INDEX_DIR, embeddingsModel);
  } else {
    vectorStore = new HNSWLib(embeddingsModel, { space: "cosine" });
  }

  // ✅ Playwright browser (tek kez aç)
  const browser = await chromium.launch({ headless: true });

  let embedsDone = 0;
  let pagesSkippedSameHash = 0;
  let chunksAdded = 0;

  try {
    // ========= 1) WEB INGEST =========
    const pages = await crawl(browser);

    for (const p of pages) {
      const pageHash = sha256(p.text);
      if (pagesState[p.url] && pagesState[p.url] === pageHash) {
        pagesSkippedSameHash++;
        continue;
      }

      const docs = await splitter.createDocuments([p.text], [{ source: p.url }]);

      const isHizmet = p.url.includes("/hizmet?");
      const cap = isHizmet ? MAX_CHUNKS_PER_HIZMET_PAGE : MAX_CHUNKS_PER_PAGE;
      const limitedDocs = docs.slice(0, cap);

      for (let i = 0; i < limitedDocs.length; i++) {
        if (embedsDone >= MAX_EMBEDS_PER_RUN) break;

        const d = limitedDocs[i];
        const chunkText = (d.pageContent || "").trim();
        if (!chunkText || chunkText.length < 80) continue;

        const chunkHash = sha256(p.url + "::" + chunkText);
        if (chunksState[chunkHash]) continue;

        await sleep(DELAY_MS);
        const vec = await embeddingsModel.embedQuery(chunkText);
        embedsDone++;

        const chunk_id = Date.now() + Math.floor(Math.random() * 1000);

        embeddingsArr.push({
          text: chunkText,
          embedding: vec,
          source: p.url,
          chunk_id,
          source_type: "web",
        });

        chunksState[chunkHash] = { source: p.url, chunk_id };

        await vectorStore.addVectors(
          [vec],
          [
            new Document({
              pageContent: chunkText,
              metadata: { source: p.url, chunk_id, source_type: "web" },
            }),
          ]
        );

        chunksAdded++;
      }

      pagesState[p.url] = pageHash;

      if (embedsDone >= MAX_EMBEDS_PER_RUN) break;
    }

    // ========= 2) DOCX INGEST (SSS.docx) =========
    // Not: DOCX "tamamını" alıyoruz. Limit sadece MAX_EMBEDS_PER_RUN ile kontrol edilir.
    if (embedsDone < MAX_EMBEDS_PER_RUN) {
      const sssText = await loadDocxAsText(SSS_DOCX_FILE);

      if (sssText && sssText.length > 200) {
        const docxSource = "docx:sss.docx";
        const docxPageHash = sha256(sssText);

        // Docx değişmediyse yeniden işlemiyoruz
        if (!(pagesState[docxSource] && pagesState[docxSource] === docxPageHash)) {
          const sssDocs = await splitter.createDocuments(
            [sssText],
            [{ source: docxSource, source_type: "docx", file: "sss.docx" }]
          );

          // Docx 
          for (let i = 0; i < sssDocs.length; i++) {
            if (embedsDone >= MAX_EMBEDS_PER_RUN) break;

            const d = sssDocs[i];
            const chunkText = (d.pageContent || "").trim();
            if (!chunkText || chunkText.length < 80) continue;

            const chunkHash = sha256(docxSource + "::" + chunkText);
            if (chunksState[chunkHash]) continue;

            await sleep(DELAY_MS);
            const vec = await embeddingsModel.embedQuery(chunkText);
            embedsDone++;

            const chunk_id = Date.now() + Math.floor(Math.random() * 1000);

            embeddingsArr.push({
              text: chunkText,
              embedding: vec,
              source: docxSource,
              chunk_id,
              source_type: "docx",
              file: "sss.docx",
            });

            chunksState[chunkHash] = { source: docxSource, chunk_id };

            await vectorStore.addVectors(
              [vec],
              [
                new Document({
                  pageContent: chunkText,
                  metadata: { source: docxSource, chunk_id, source_type: "docx", file: "sss.docx" },
                }),
              ]
            );

            chunksAdded++;
          }

          // Docx state güncelle
          pagesState[docxSource] = docxPageHash;
        }
      } else {
        console.warn("SSS.docx okunamadı:", SSS_DOCX_FILE);
      }
    }

    // ========= SAVE =========
    writeJson(EMBEDDINGS_FILE, embeddingsArr);
    writeJson(PAGES_STATE_FILE, pagesState);
    writeJson(CHUNKS_STATE_FILE, chunksState);

    fs.mkdirSync(INDEX_DIR, { recursive: true });
    await vectorStore.save(INDEX_DIR);

    console.log("\n==============================");
    console.log("Pipeline bitti");
    console.log("Bu koşuda embed edilen chunk:", embedsDone);
    console.log("Index'e eklenen yeni chunk:", chunksAdded);
    console.log("Embeddings total:", embeddingsArr.length);
    console.log("Index dir:", INDEX_DIR);
    console.log("==============================\n");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Pipeline hata:", err);
  process.exit(1);
});