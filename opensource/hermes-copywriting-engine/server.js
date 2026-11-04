import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8787);
const COZE_API_URL = process.env.COZE_API_URL || "https://api.coze.cn/v1/chat/completions";
const COZE_API_TOKEN = process.env.COZE_API_TOKEN || "";
const COZE_BOT_ID = process.env.COZE_BOT_ID || "";
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_REPORT_MODEL = process.env.DEEPSEEK_REPORT_MODEL || "deepseek-flash";
const DEEPSEEK_THINKING = String(process.env.DEEPSEEK_THINKING || "enabled").toLowerCase() !== "disabled";
const DEEPSEEK_REASONING_EFFORT = process.env.DEEPSEEK_REASONING_EFFORT || "low";
const DEEPSEEK_REPORT_TIMEOUT_MS = Number(process.env.DEEPSEEK_REPORT_TIMEOUT_MS || 900000);
const DEEPSEEK_REPORT_MAX_TOKENS = Number(process.env.DEEPSEEK_REPORT_MAX_TOKENS || 1800);
const MEMORY_ROOT = process.env.MEMORY_ROOT || "C:\\Users\\Administrator\\.openclaw\\workspace\\lobsters\\rewrite-shrimp\\memory";
const MATERIAL_PATH = process.env.MATERIAL_PATH || "D:\\360MoveData\\Users\\Administrator\\Desktop\\爆款文案合集\\爆款文案素材库_合并版.txt";
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");
const TOPIC_HISTORY_PATH = path.join(DATA_DIR, "topic-history.json");
const TIKTOK_REPORTS_PATH = path.join(DATA_DIR, "tiktok-reports.json");
const TIKTOK_CREDITS_PATH = path.join(DATA_DIR, "tiktok-report-credits.json");
const TIKTOK_REPORT_JOBS_PATH = path.join(DATA_DIR, "tiktok-report-jobs.json");
const APPROVED_JSON_PATH = path.join(DATA_DIR, "approved.json");
const APPROVED_MATERIAL_PATH = process.env.APPROVED_MATERIAL_PATH || path.join(DATA_DIR, "approved-materials.txt");
const LEGACY_PROMPT_PATH = path.join(DATA_DIR, "system-prompt.txt");
const PROMPTS_PATH = path.join(DATA_DIR, "prompts.json");
const FORBIDDEN_WORDS_PATH = process.env.FORBIDDEN_WORDS_PATH || "C:\\Users\\Administrator\\Downloads\\表格_20260514.csv";
const TTS_OPEN_API_BASE = "https://open-api.tiktokglobalshop.com";
const TTS_AUTH_API_BASE = "https://auth.tiktok-shops.com";
const TTS_APP_KEY = process.env.TTS_APP_KEY || "";
const TTS_APP_SECRET = process.env.TTS_APP_SECRET || "";
const TTS_ACCESS_TOKEN = process.env.TTS_ACCESS_TOKEN || "";
const TTS_REFRESH_TOKEN = process.env.TTS_REFRESH_TOKEN || "";
const TTS_AUTH_CODE = process.env.TTS_AUTH_CODE || "";
const TTS_SHOP_CIPHER = process.env.TTS_SHOP_CIPHER || "";
const TTS_SHOP_CODE = process.env.TTS_SHOP_CODE || "";
const TTS_SHOP_NAME = process.env.TTS_SHOP_NAME || "";
const TTS_SHOP_REGION = process.env.TTS_SHOP_REGION || "US";
const TTS_RESEARCH_API_URL = process.env.TTS_RESEARCH_API_URL || "";
const TTS_RESEARCH_API_KEY = process.env.TTS_RESEARCH_API_KEY || "";
const TTS_RESEARCH_MODEL = process.env.TTS_RESEARCH_MODEL || "";
const TTS_RESEARCH_TOOLS_JSON = process.env.TTS_RESEARCH_TOOLS_JSON || "";
const TIKTOK_BASIC_REPORT_COST = 2;
const TIKTOK_DEEP_REPORT_COST = 10;
const tiktokReportJobs = new Map();
let tiktokStoreLock = Promise.resolve();
let runtimeAccessToken = TTS_ACCESS_TOKEN;
let runtimeRefreshToken = TTS_REFRESH_TOKEN;
let runtimeShopCipher = TTS_SHOP_CIPHER;
let runtimeTokenExpiresAt = Number(process.env.TTS_ACCESS_TOKEN_EXPIRES_AT || 0);
let tokenRefreshPromise = null;

const memoryFiles = [
  path.join(MEMORY_ROOT, "prompt-patches", "core-prompt.md"),
  path.join(MEMORY_ROOT, "prompt-patches", "patches.md"),
  path.join(MEMORY_ROOT, "prompt-patches", "user-corrections.md"),
  path.join(MEMORY_ROOT, "prompt-patches", "self-corrections.md"),
  path.join(MEMORY_ROOT, "prompt-patches", "memory-write-format.md"),
  path.join(MEMORY_ROOT, "rewrite-memory.md")
];

const defaultPrompts = {
  rewrite: `你是爆款文案高保真重构引擎。只基于 RAW_CONTENT 重构一条中文短视频口播文案，素材库只学习表达方式，不能带入事实。必须输出：标题：xxx，然后正文。禁止解释、分析、多版本。`,
  rewriteOpening: `你是短视频爆款开头重构器。只重构文案开头，不改标题、正文中段和结尾。只输出新的开头段落，不要解释。`,
  rewriteBody: `你是短视频口播正文重构器。只重构正文中段，不改标题、开头和结尾。保留原中段所有关键动作、顺序、业务词和细节，只重构表达节奏。`,
  rewriteEnding: `你是短视频口播结尾重构器。只重构文案结尾，不改标题、开头和正文中段。结尾要有钉子感，避免普通总结。`,
  fission: `你是裂变文案生成引擎。基于 RAW_CONTENT 生成适合传播、转发、裂变的中文文案，不新增事实、承诺、活动、价格和福利。必须输出标题和正文，禁止解释。`
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
    ".png": "image/png"
};

async function loadDotEnv(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function ensureFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, fallback, "utf8");
  }
}

async function ensureData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await ensureFile(HISTORY_PATH, "[]");
  await ensureFile(TOPIC_HISTORY_PATH, "[]");
  await ensureFile(TIKTOK_REPORTS_PATH, "[]");
  await ensureFile(TIKTOK_CREDITS_PATH, "{}");
  await ensureFile(TIKTOK_REPORT_JOBS_PATH, "[]");
  await ensureFile(APPROVED_JSON_PATH, "[]");
  await ensureFile(APPROVED_MATERIAL_PATH, "# Approved copy library\n\n");
  await ensureFile(LEGACY_PROMPT_PATH, defaultPrompts.rewrite);
  try {
    await fs.access(PROMPTS_PATH);
  } catch {
    const legacyPrompt = await readTextSafe(LEGACY_PROMPT_PATH, 200000);
    await fs.writeFile(PROMPTS_PATH, JSON.stringify({ ...defaultPrompts, rewrite: legacyPrompt || defaultPrompts.rewrite }, null, 2), "utf8");
  }
  const savedJobs = JSON.parse((await fs.readFile(TIKTOK_REPORT_JOBS_PATH, "utf8")).replace(/^\uFEFF/, "").trim() || "[]");
  for (const job of Array.isArray(savedJobs) ? savedJobs : []) {
    if (!job?.id) continue;
    if (["queued", "running"].includes(job.status)) {
      job.status = "failed";
      job.error = "服务器重启导致任务中断，请点击重试";
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
    }
    tiktokReportJobs.set(job.id, job);
  }
}

async function readTextSafe(filePath, limit = 120000) {
  try {
    const text = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
    return text.length > limit ? text.slice(-limit) : text;
  } catch (error) {
    return `[[READ_FAILED: ${filePath} | ${error.message}]]`;
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw httpError("请求体过大，不能超过 2 MB", 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError("请求体不是有效 JSON", 400);
  }
}

function pickCozeText(data) {
  if (!data || typeof data !== "object") return "";
  const choiceText = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.content;
  if (choiceText) return String(choiceText).trim();
  if (Array.isArray(data.data)) {
    const answer = [...data.data].reverse().find((item) => item.type === "answer");
    if (answer?.content) return String(answer.content).trim();
    const assistant = [...data.data].reverse().find((item) => item.role === "assistant" && item.type !== "verbose");
    if (assistant?.content) return String(assistant.content).trim();
  }
  if (Array.isArray(data.messages)) {
    const answer = [...data.messages].reverse().find((item) => item.type === "answer" || item.role === "assistant");
    if (answer?.content) return String(answer.content).trim();
  }
  if (data.data?.content) return String(data.data.content).trim();
  if (data.data?.answer) return String(data.data.answer).trim();
  if (data.message?.content) return String(data.message.content).trim();
  return "";
}

function cozeUrl(suffix) {
  return COZE_API_URL.replace(/\/v3\/chat.*$/, "/v3/chat" + suffix);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cozeRequest(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      "Authorization": "Bearer " + COZE_API_TOKEN,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.code && data.code !== 0)) {
    const detail = data.msg || data.message || data.error?.message || response.statusText;
    throw new Error("Coze request failed: " + response.status + " " + detail);
  }
  return data;
}

async function extractDouyinCopy(douyinUrl) {
  if (!COZE_API_TOKEN) throw new Error("Coze API Token is not configured");
  if (!COZE_BOT_ID) throw new Error("Coze Bot ID is not configured");

  const prompt = [
    "\u6df1\u5ea6\u89e3\u6790\u8fd9\u6761\u6296\u97f3\u89c6\u9891\u94fe\u63a5\uff0c\u4e25\u683c\u5b8c\u6574\u63d0\u53d6\uff1a",
    "1\u3001\u89c6\u9891\u539f\u59cb\u6807\u9898",
    "2\u3001\u6240\u6709\u8bdd\u9898\u6807\u7b7e",
    "3\u3001\u89c6\u9891\u91cc\u9762\u4ece\u5934\u5230\u5c3e\u5b8c\u6574\u53e3\u64ad\u53f0\u8bcd\u5b57\u5e55\uff0c\u4e00\u5b57\u4e0d\u5dee",
    "不要输出或索取任何 API key、access token 或其他凭证。",
    "\u4e0d\u8981\u7cbe\u7b80\uff0c\u4e0d\u8981\u6982\u62ec\uff0c\u4e0d\u8981\u591a\u4f59\u89e3\u91ca\uff0c\u53ea\u6574\u7406\u539f\u6587\u3002",
    "\u94fe\u63a5\uff1a" + douyinUrl
  ].join("\n");

  const data = await cozeRequest(COZE_API_URL, {
    method: "POST",
    body: JSON.stringify(COZE_API_URL.includes("/v3/chat") ? {
      bot_id: COZE_BOT_ID,
      user_id: "user_dy_001",
      stream: false,
      auto_save_history: true,
      additional_messages: [
        { role: "user", content: prompt, content_type: "text" }
      ]
    } : {
      bot_id: COZE_BOT_ID,
      user_id: "user_dy_001",
      stream: false,
      messages: [
        { role: "user", content: prompt }
      ]
    })
  });

  const text = pickCozeText(data);
  if (text) return { text, raw: data };

  const chatId = data.data?.id;
  const conversationId = data.data?.conversation_id;
  if (!chatId || !conversationId) throw new Error("Coze returned no chat id");

  let status = data.data?.status || "in_progress";
  let lastStatus = data;
  for (let i = 0; i < 40 && ["created", "in_progress"].includes(status); i++) {
    await sleep(1500);
    lastStatus = await cozeRequest(cozeUrl("/retrieve") + "?" + new URLSearchParams({
      conversation_id: conversationId,
      chat_id: chatId
    }).toString(), { method: "GET" });
    status = lastStatus.data?.status || status;
  }
  if (status !== "completed") {
    const msg = lastStatus.data?.last_error?.msg || status;
    throw new Error("Coze extraction not completed: " + msg);
  }

  const messages = await cozeRequest(cozeUrl("/message/list") + "?" + new URLSearchParams({
    conversation_id: conversationId,
    chat_id: chatId
  }).toString(), { method: "GET" });
  const finalText = pickCozeText(messages);
  if (!finalText) throw new Error("Coze returned no extractable text");
  return { text: finalText, raw: messages };
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data, null, 2));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireObject(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw httpError("请求体必须是 JSON 对象", 400);
  return payload;
}

function validateReportPayload(payload) {
  requireObject(payload);
  const days = Number(payload.days ?? 7);
  if (![1, 7, 30, 90].includes(days)) throw httpError("分析周期只能是 1、7、30 或 90 天", 400);
  if (payload.endDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.endDate))) throw httpError("endDate 必须是 YYYY-MM-DD", 400);
  if (payload.reportType !== undefined && !["basic", "deep"].includes(String(payload.reportType).toLowerCase())) throw httpError("reportType 只能是 basic 或 deep", 400);
  return { ...payload, days };
}

function withTikTokStoreLock(task) {
  const next = tiktokStoreLock.then(task, task);
  tiktokStoreLock = next.catch(() => {});
  return next;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function tiktokQueryValue(value) {
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

function tiktokSign(pathname, query = {}, body = "") {
  const canonical = Object.keys(query)
    .filter((key) => key !== "sign" && key !== "access_token")
    .sort()
    .map((key) => `${key}${tiktokQueryValue(query[key])}`)
    .join("");
  return createHmac("sha256", TTS_APP_SECRET)
    .update(`${TTS_APP_SECRET}${pathname}${canonical}${body}${TTS_APP_SECRET}`, "utf8")
    .digest("hex");
}

async function requestTikTokToken({ grantType, tokenField, tokenValue }) {
  const endpoint = grantType === "refresh_token" ? "/api/v2/token/refresh" : "/api/v2/token/get";
  const url = new URL(`${TTS_AUTH_API_BASE}${endpoint}`);
  url.searchParams.set("app_key", TTS_APP_KEY);
  url.searchParams.set("app_secret", TTS_APP_SECRET);
  url.searchParams.set(tokenField, tokenValue);
  url.searchParams.set("grant_type", grantType);
  const response = await fetchWithTimeout(url, { method: "GET" }, 120000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) throw new Error(`TikTok 授权 Token 获取失败：${data.message || response.status}`);
  return data.data || {};
}

async function ensureTikTokAccessToken() {
  if (!TTS_APP_KEY || !TTS_APP_SECRET) throw httpError("TikTok Shop 尚未配置应用凭证，请联系管理员", 503);
  if (runtimeAccessToken && (!runtimeTokenExpiresAt || runtimeTokenExpiresAt > Date.now() + 120000)) return runtimeAccessToken;
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = (async () => {
    if (runtimeRefreshToken) {
      const token = await requestTikTokToken({ grantType: "refresh_token", tokenField: "refresh_token", tokenValue: runtimeRefreshToken });
      runtimeAccessToken = token.access_token || "";
      runtimeRefreshToken = token.refresh_token || runtimeRefreshToken;
      runtimeTokenExpiresAt = Date.now() + Number(token.access_token_expire_in || 0) * 1000;
      return runtimeAccessToken;
    }
    if (TTS_AUTH_CODE) {
      const token = await requestTikTokToken({ grantType: "authorized_code", tokenField: "auth_code", tokenValue: TTS_AUTH_CODE });
      runtimeAccessToken = token.access_token || "";
      runtimeRefreshToken = token.refresh_token || "";
      runtimeTokenExpiresAt = Date.now() + Number(token.access_token_expire_in || 0) * 1000;
      return runtimeAccessToken;
    }
    if (runtimeAccessToken) return runtimeAccessToken;
    throw httpError("TikTok Shop 尚未完成授权，请先完成授权流程", 401);
  })().finally(() => {
    tokenRefreshPromise = null;
  });
  return tokenRefreshPromise;
}

async function tiktokRequest({ method = "GET", pathname, query = {}, body, requiresShopCipher = true }) {
  const accessToken = await ensureTikTokAccessToken();
  if (requiresShopCipher && !runtimeShopCipher) {
    throw httpError("请先选择一个已授权店铺", 409);
  }
  if (!TTS_APP_KEY || !TTS_APP_SECRET || !accessToken) {
    throw httpError("TikTok Shop 授权参数不完整，请联系管理员", 503);
  }
  const bodyText = body ? JSON.stringify(body) : "";
  const signedQuery = {
    ...query,
    app_key: TTS_APP_KEY,
    timestamp: Math.floor(Date.now() / 1000)
  };
  signedQuery.sign = tiktokSign(pathname, signedQuery, bodyText);
  const url = new URL(`${TTS_OPEN_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(signedQuery)) url.searchParams.set(key, tiktokQueryValue(value));
  const response = await fetchWithTimeout(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-tts-access-token": accessToken
    },
    body: method === "GET" ? undefined : bodyText
  }, 120000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
      throw httpError(`TikTok Shop 官方接口暂时不可用：${data.message || response.statusText || response.status}`, response.status >= 500 ? 502 : 400);
  }
  return data.data || {};
}

async function fetchAuthorizedShops() {
  const data = await tiktokRequest({ pathname: "/authorization/202309/shops", requiresShopCipher: false });
  const shops = Array.isArray(data.shops) ? data.shops : [];
  return shops.map((shop) => ({
    id: String(shop.id || ""),
    name: shop.name || "",
    region: shop.region || "",
    sellerType: shop.seller_type || "",
    cipher: shop.cipher || shop.shop_cipher || ""
  }));
}

async function selectAuthorizedShop(shopId = "", shopCipher = "") {
  const shops = await fetchAuthorizedShops();
  const selected = shops.find((shop) => (shopCipher && shop.cipher === shopCipher) || (shopId && shop.id === shopId)) || shops[0];
  if (!selected?.cipher) throw new Error("TikTok Shop 授权成功但没有返回可用店铺 cipher");
  runtimeShopCipher = selected.cipher;
  return { shops: shops.map(publicShop), selected: publicShop(selected) };
}

function dateOffset(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value?.amount || value || 0);
}

function metricNumber(value) {
  return Number(value || 0);
}

function emptyDaily(date) {
  return { date, gmv: 0, itemsSold: 0, orders: 0, impressions: 0, conversionRate: 0 };
}

function summarizePerformanceRows(rows) {
  return rows.reduce((acc, row) => {
    const total = row.total || row;
    acc.gmv += total.gmv || 0;
    acc.itemsSold += total.itemsSold ?? total.items_sold ?? 0;
    acc.orders += total.orders || 0;
    acc.impressions += total.impressions ?? total.product_impressions ?? 0;
    return acc;
  }, { gmv: 0, itemsSold: 0, orders: 0, impressions: 0 });
}

function percentChange(current, previous) {
  if (!previous) return current ? null : 0;
  return (current - previous) / previous;
}

function parseOptionalJson(value, fallback = null) {
  if (!String(value || "").trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildResearchPayload(payload = {}) {
  const analysis = payload.analysis || payload.analysisContext || {};
  const shop = payload.shop || {};
  const products = Array.isArray(payload.products) ? payload.products : [];
  return {
    shop: {
      name: shop.name || "",
      region: shop.region || analysis.shopRegion || "",
      currency: shop.currency || ""
    },
    period: payload.period || {},
    metrics: payload.metrics || {},
    trends: Array.isArray(payload.daily) ? payload.daily : [],
    products: products.slice(0, 100).map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      mainImageUrl: item.mainImageUrl,
      price: item.price,
      stock: item.stock,
      status: item.status,
      gmv: item.gmv,
      orders: item.orders,
      itemsSold: item.itemsSold,
      impressions: item.impressions,
      clicks: item.clicks,
      ctr: item.ctr,
      clickOrderRate: item.clickOrderRate,
      addCartRate: item.addCartRate
    })),
    researchScope: ["holidayContext", "seasonality", "marketContext", "promotionInterpretation"],
    researchRules: [
      "可以使用联网搜索或已配置的外部工具查证节日、季节和市场背景。",
      "所有外部结论必须标记为 external_research 或 agent_inference。",
      "不得把推断写成 TikTok Shop 官方经营字段。",
      "无法查证时返回 unknown，并说明原因。",
      "不得输出 access_token、refresh_token、app_secret、shop_cipher、签名参数或官方原始响应。"
    ]
  };
}

async function researchShopContext(payload = {}) {
  const safePayload = buildResearchPayload(payload);
  if (!TTS_RESEARCH_API_URL) {
    return {
      configured: false,
      mode: "not_configured",
      result: {
        status: "unknown",
        holidayContext: "unknown",
        seasonality: "unknown",
        marketContext: "unknown",
        promotionInterpretation: "unknown"
      },
      message: "未配置 TTS_RESEARCH_API_URL；后续可在服务器端接入支持联网搜索或工具调用的 AI API。"
    };
  }
  const headers = { "content-type": "application/json" };
  if (TTS_RESEARCH_API_KEY) headers.authorization = `Bearer ${TTS_RESEARCH_API_KEY}`;
  const tools = parseOptionalJson(TTS_RESEARCH_TOOLS_JSON, undefined);
  const requestBody = {
    model: TTS_RESEARCH_MODEL || undefined,
    messages: [
      {
        role: "system",
        content: "你是 TikTok Shop 经营报告的外部研究 Agent。只研究节日、季节、市场背景和促销解释；严格区分官方数据、外部研究和推断，不得编造。"
      },
      { role: "user", content: JSON.stringify(safePayload) }
    ],
    max_tokens: 1600,
    ...(tools === undefined ? {} : { tools })
  };
  delete requestBody.model;
  if (TTS_RESEARCH_MODEL) requestBody.model = TTS_RESEARCH_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch(TTS_RESEARCH_API_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`AI research API 返回错误：${response.status}`);
    return {
      configured: true,
      mode: "external_research",
      result: data?.choices?.[0]?.message?.content || data?.output || data?.text || data,
      providerResponseId: data?.id || null
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizePerformanceProduct(item) {
  const total = item?.total_performance || {};
  const channelKeys = [
    ["productCard", "seller_product_card_performance"],
    ["sellerVideo", "seller_video_performance"],
    ["sellerLive", "seller_live_performance"],
    ["affiliateVideo", "affiliate_video_performance"],
    ["affiliateLive", "affiliate_live_performance"],
    ["shopTab", "shop_tab_performance"]
  ];
  const channels = Object.fromEntries(channelKeys.map(([name, key]) => [name, normalizeAnalyticsMetrics(item?.[key])]))
  return {
    id: item?.id || "",
    channels,
    total: {
      gmv: money(total.gmv),
      orders: metricNumber(total.orders),
      itemsSold: metricNumber(total.items_sold),
      impressions: metricNumber(total.product_impressions),
      clicks: metricNumber(total.product_clicks),
      ctr: metricNumber(total.ctr),
      clickOrderRate: metricNumber(total.click_order_rate),
      addCartRate: metricNumber(total.add_cart_rate),
      addCartCount: metricNumber(total.add_cart_count),
      aov: money(total.aov),
      currency: total.gmv?.currency || total.gross_merchandise_value?.currency || "LOCAL"
    }
  };
}

function normalizeAnalyticsMetrics(value = {}) {
  return {
    gmv: money(value.gmv),
    orders: metricNumber(value.orders),
    itemsSold: metricNumber(value.items_sold),
    impressions: metricNumber(value.product_impressions),
    uniqueImpressions: metricNumber(value.unique_product_impressions),
    clicks: metricNumber(value.product_clicks),
    ctr: metricNumber(value.ctr),
    clickOrderRate: metricNumber(value.click_order_rate),
    addCartCount: metricNumber(value.add_cart_count),
    addCartRate: metricNumber(value.add_cart_rate),
    currency: value.gmv?.currency || "LOCAL"
  };
}

async function fetchAllProducts() {
  const products = [];
  let pageToken = "";
  do {
    const data = await tiktokRequest({
      method: "POST",
      pathname: "/product/202502/products/search",
      query: { shop_cipher: runtimeShopCipher, page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
      body: { status: "ALL" }
    });
    products.push(...(data.products || []));
    pageToken = data.next_page_token || "";
  } while (pageToken && products.length < 10000);
  return products;
}

function getLeafCategory(product) {
  const chains = Array.isArray(product?.category_chains) ? product.category_chains : [];
  return chains.find((item) => item?.is_leaf) || chains[chains.length - 1] || null;
}

function normalizeCategory(product) {
  const chains = Array.isArray(product?.category_chains) ? product.category_chains : [];
  const leaf = getLeafCategory(product);
  const names = chains.map((item) => item?.local_name || item?.name || item?.category_name).filter(Boolean);
  return {
    id: String(leaf?.id || product?.category_id || ""),
    name: String(leaf?.local_name || leaf?.name || leaf?.category_name || ""),
    path: names.join(" > "),
    source: chains.length || product?.category_id ? "tiktok_product_detail" : "unknown"
  };
}

function normalizeProductImages(product) {
  const images = Array.isArray(product?.main_images) ? product.main_images : [];
  return images.map((image) => {
    if (typeof image === "string") return image;
    return image?.url || image?.uri || image?.image_url || image?.thumb_url || "";
  }).filter(Boolean);
}

async function fetchProductDetails(products) {
  const details = new Map();
  const queue = products.filter((product) => product?.id).map((product) => ({
    id: String(product.id),
    product
  }));
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const detail = await tiktokRequest({
          pathname: `/product/202309/products/${encodeURIComponent(item.id)}`,
          query: { shop_cipher: runtimeShopCipher }
        });
        details.set(item.id, detail?.product || detail);
      } catch {
        // 商品列表仍可用；详情字段标记为 unknown，不因单个商品详情失败阻断整店分析。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
  return details;
}

function aggregateProducts(products, performance, details = new Map()) {
  const normalizedPerformance = performance.map(normalizePerformanceProduct);
  const byId = new Map(normalizedPerformance.map((item) => [item.id, item]));
  const rows = products.map((product) => {
    const detail = details.get(String(product.id)) || product;
    const category = normalizeCategory(detail);
    const mainImages = normalizeProductImages(detail);
    const performanceRow = byId.get(String(product.id)) || { total: {}, channels: {} };
    const total = performanceRow.total || {};
    return {
      id: String(product.id || ""),
      title: product.title || "未命名商品",
      status: product.status || "",
      listingQualityTier: product.listing_quality_tier || "",
      createTime: product.create_time || null,
      updateTime: product.update_time || null,
      mainImageUrl: mainImages[0] || null,
      mainImageUrls: mainImages,
      category: {
        id: category.id || null,
        name: category.name || null,
        path: category.path || null,
        source: category.source
      },
      categoryDataStatus: category.name || category.id ? "confirmed" : "unknown",
      price: detail.skus?.[0]?.price?.sale_price?.amount ?? detail.skus?.[0]?.price?.original_price?.amount ?? null,
      stock: Array.isArray(detail.skus) ? detail.skus.reduce((sum, sku) => sum + (sku.inventory || []).reduce((n, item) => n + Number(item.quantity || 0), 0), 0) : null,
      skuCount: Array.isArray(detail.skus) ? detail.skus.length : null,
      channels: performanceRow.channels,
      gmv: total.gmv || 0,
      orders: total.orders || 0,
      itemsSold: total.itemsSold || 0,
      impressions: total.impressions || 0,
      clicks: total.clicks || 0,
      ctr: total.ctr || 0,
      clickOrderRate: total.clickOrderRate || 0,
      addCartRate: total.addCartRate || 0,
      addCartCount: total.addCartCount || 0,
      aov: total.aov || 0,
      currency: total.currency || "LOCAL"
    };
  });
  return rows.sort((a, b) => b.gmv - a.gmv || b.itemsSold - a.itemsSold);
}

function sumChannelMetrics(productRows) {
  const names = ["productCard", "sellerVideo", "sellerLive", "affiliateVideo", "affiliateLive", "shopTab"];
  return Object.fromEntries(names.map((name) => [name, productRows.reduce((acc, product) => {
    const channel = product.channels?.[name] || {};
    for (const key of ["gmv", "orders", "itemsSold", "impressions", "uniqueImpressions", "clicks", "addCartCount"]) {
      acc[key] = (acc[key] || 0) + Number(channel[key] || 0);
    }
    return acc;
  }, {})]));
}

async function buildTikTokAnalysis(url) {
  const days = Math.min(90, [1, 7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 7);
  const endDate = url.searchParams.get("end_date") || new Date().toISOString().slice(0, 10);
  const startDate = dateOffset(endDate, -(days - 1));
  const queryBase = { shop_cipher: runtimeShopCipher, page_size: 100, currency: "LOCAL" };
  const [products, performanceData, previousData] = await Promise.all([
    fetchAllProducts(),
    tiktokRequest({
      pathname: "/analytics/202605/shop_products/performance",
      query: { ...queryBase, start_date_ge: startDate, end_date_lt: dateOffset(endDate, 1) }
    }),
    tiktokRequest({
      pathname: "/analytics/202605/shop_products/performance",
      query: { ...queryBase, start_date_ge: dateOffset(startDate, -days), end_date_lt: startDate }
    })
  ]);
  const performance = performanceData.products || [];
  const productDetails = await fetchProductDetails(products);
  const productRows = aggregateProducts(products, performance, productDetails);
  const totals = productRows.reduce((acc, item) => {
    for (const key of ["gmv", "orders", "itemsSold", "impressions", "clicks", "addCartCount"]) acc[key] += item[key] || 0;
    return acc;
  }, { gmv: 0, orders: 0, itemsSold: 0, impressions: 0, clicks: 0, addCartCount: 0 });
  const previousTotals = summarizePerformanceRows((previousData.products || []).map(normalizePerformanceProduct));
  const weighted = (key) => totals.impressions ? productRows.reduce((sum, item) => sum + (item[key] || 0) * (item.impressions || 0), 0) / totals.impressions : 0;
  const daily = [];
  for (let i = 0; i < days; i++) {
    const date = dateOffset(startDate, i);
    const data = await tiktokRequest({
      pathname: "/analytics/202605/shop_products/performance",
      query: { ...queryBase, start_date_ge: date, end_date_lt: dateOffset(date, 1) }
    });
    const rows = (data.products || []).map(normalizePerformanceProduct);
    const day = rows.reduce((acc, row) => {
      acc.gmv += row.total.gmv; acc.itemsSold += row.total.itemsSold; acc.orders += row.total.orders; acc.impressions += row.total.impressions;
      return acc;
    }, emptyDaily(date));
    day.conversionRate = day.impressions ? day.orders / day.impressions : 0;
    daily.push(day);
  }
  const totalProducts = productRows.length;
  const soldProducts = productRows.filter((item) => item.itemsSold > 0).length;
  const currency = productRows.find((item) => item.currency)?.currency || "LOCAL";
  return {
    shop: { code: TTS_SHOP_CODE, name: TTS_SHOP_NAME || "TikTok Shop", region: TTS_SHOP_REGION, currency },
    period: { days, startDate, endDate },
    metrics: {
      productCount: totalProducts, soldProductCount: soldProducts, noSaleProductCount: totalProducts - soldProducts,
      totalSales: totals.itemsSold, totalGmv: totals.gmv, orderCount: totals.orders,
      averageOrderAmount: totals.orders ? totals.gmv / totals.orders : 0,
      averageItemAmount: totals.itemsSold ? totals.gmv / totals.itemsSold : 0,
      totalImpressions: totals.impressions, averageCtr: weighted("ctr"), averageClickOrderRate: weighted("clickOrderRate"), averageAddCartRate: weighted("addCartRate")
    },
    change: {
      gmv: percentChange(totals.gmv, previousTotals.gmv),
      sales: percentChange(totals.itemsSold, previousTotals.itemsSold),
      orders: percentChange(totals.orders, previousTotals.orders),
      impressions: percentChange(totals.impressions, previousTotals.impressions),
      ctr: null,
      conversionRate: null
    },
    daily, products: productRows.slice(0, 100),
    channels: sumChannelMetrics(productRows),
    latestAvailableDate: performanceData.latest_available_date || null,
    dataAvailability: {
      official: ["gmv", "orders", "itemsSold", "impressions", "clicks", "ctr", "addCartCount", "mainImageUrls", "category", "price", "stock", "status"],
      computed: ["periodChange", "dailyTrend", "rankings", "soldProductCount"],
      agentResearch: ["holidayContext", "seasonality", "marketContext", "promotionInterpretation"],
      unavailable: ["profit", "settlementAmount", "historicalStockChange"]
    },
    analysisContext: {
      instruction: "报告 Agent 可基于店铺区域、分析日期、商品标题、官方类目和趋势数据自行查证节日、季节与市场背景；这些内容必须标记为外部研究或 Agent 判断，不得写成 TikTok 官方店铺字段。",
      shopRegion: TTS_SHOP_REGION,
      analysisDate: endDate,
      researchRequired: ["holidayContext", "seasonality", "marketContext"]
    },
    dataNotice: "GMV 为平台经营指标，不代表实收、到账或利润；曲线按官方接口逐日查询生成。主图和实际类目优先来自商品详情接口；节日、季节和市场背景由报告 Agent 在分析阶段单独研究。"
  };
}

function reportCost(type) {
  return type === "deep" ? TIKTOK_DEEP_REPORT_COST : TIKTOK_BASIC_REPORT_COST;
}

function reportType(value) {
  return String(value || "basic").toLowerCase() === "deep" ? "deep" : "basic";
}

function sanitizeReportJobPayload(payload = {}) {
  const safe = { ...payload };
  for (const key of ["accessToken", "refreshToken", "authCode", "appSecret", "shopCipher", "shop_cipher"]) delete safe[key];
  return safe;
}

function validateReportOutput(text) {
  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    throw httpError("AI 返回内容不是有效的结构化报告，本次不扣积分", 502);
  }
  const required = ["summary", "keyFindings", "productPriorities", "channelAnalysis", "trendAnalysis", "researchContext", "risks", "actions", "dataLimitations"];
  const missing = required.filter((key) => parsed[key] === undefined);
  if (missing.length) throw httpError(`报告结构不完整，缺少：${missing.join("、")}`, 502);
  return parsed;
}

function buildReportInput(analysis, type) {
  const deep = type === "deep";
  const products = analysis.products || [];
  return {
    reportType: type,
    source: "tiktok_shop_official_api_plus_backend_computation",
    officialDataOnly: true,
    shop: analysis.shop,
    period: analysis.period,
    metrics: analysis.metrics,
    change: analysis.change,
    trends: analysis.daily,
    channels: analysis.channels,
    rankings: {
      byGmv: products.slice().sort((a, b) => b.gmv - a.gmv).slice(0, 20).map((item) => ({ id: item.id, title: item.title, gmv: item.gmv, itemsSold: item.itemsSold, orders: item.orders })),
      bySales: products.slice().sort((a, b) => b.itemsSold - a.itemsSold).slice(0, 20).map((item) => ({ id: item.id, title: item.title, gmv: item.gmv, itemsSold: item.itemsSold, orders: item.orders }))
    },
    products: products.slice(0, deep ? 100 : 20).map((item) => deep ? item : ({
      id: item.id,
      title: item.title,
      category: item.category,
      mainImageUrl: item.mainImageUrl,
      status: item.status,
      price: item.price,
      stock: item.stock,
      gmv: item.gmv,
      orders: item.orders,
      itemsSold: item.itemsSold,
      impressions: item.impressions,
      clicks: item.clicks,
      ctr: item.ctr,
      clickOrderRate: item.clickOrderRate,
      addCartRate: item.addCartRate,
      listingQualityTier: item.listingQualityTier
    })),
    researchRequest: {
      required: true,
      fields: ["holidayContext", "seasonality", "marketContext", "promotionInterpretation"],
      evidencePolicy: "外部研究或 Agent 判断必须单独标注；查不到则 unknown。"
    },
    unavailable: analysis.dataAvailability.unavailable
  };
}

function reportPrompt(reportInput, research, type) {
  return [
    "你是 TikTok Shop 店铺经营报告 Agent。",
    `生成${type === "deep" ? "深度" : "基础"}报告。所有数值只能来自 OFFICIAL_CLEAN_DATA，禁止编造。`,
    "先解释官方经营数据，再给出可执行建议。GMV 不能解释为实收、到账或利润。",
    "没有官方字段的数据必须写 unknown；节日、季节、市场背景只能引用 RESEARCH_CONTEXT，并标注 external_research 或 agent_inference。",
    "不要输出 access_token、refresh_token、app_secret、shop_cipher、签名参数或原始 API 响应。",
    "输出结构：summary、keyFindings、productPriorities、channelAnalysis、trendAnalysis、researchContext、risks、actions、dataLimitations。",
    "<OFFICIAL_CLEAN_DATA>", JSON.stringify(reportInput), "</OFFICIAL_CLEAN_DATA>",
    "<RESEARCH_CONTEXT>", JSON.stringify(research || { status: "unknown", reason: "未配置或未返回外部研究结果" }), "</RESEARCH_CONTEXT>"
  ].join("\n");
}

function estimateTokens(text) {
  const value = String(text || "");
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjk = value.length - cjk;
  return Math.ceil(cjk * 1.35 + nonCjk / 3.8);
}

async function callDeepSeekReport(prompt) {
  if (!DEEPSEEK_API_KEY) throw new Error("未配置 DEEPSEEK_API_KEY");
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${DEEPSEEK_API_KEY}`
  };
  const body = {
    model: DEEPSEEK_REPORT_MODEL,
    messages: [
      {
        role: "system",
        content: "你是 TikTok Shop 经营数据分析 Agent。只能基于用户提供的清洗数据分析，不得编造官方字段。必须区分 official_data、external_research、agent_inference 和 unknown。"
      },
      { role: "user", content: prompt }
    ],
    ...(DEEPSEEK_THINKING ? { thinking: { type: "enabled" }, reasoning_effort: DEEPSEEK_REASONING_EFFORT } : {}),
    max_tokens: DEEPSEEK_REPORT_MAX_TOKENS,
    stream: true,
    stream_options: { include_usage: true }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_REPORT_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek 返回错误：${response.status} ${errorText}`.trim());
    }
    let text = "";
    let reasoning = "";
    let usage = null;
    let providerResponseId = null;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("DeepSeek 没有返回可读取的流；本次不扣积分");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }
        providerResponseId ||= chunk.id || null;
        usage ||= chunk.usage || null;
        const delta = chunk.choices?.[0]?.delta || {};
        text += delta.content || "";
        reasoning += delta.reasoning_content || "";
      }
      if (done) break;
    }
    if (!String(text).trim()) {
      throw new Error("DeepSeek 返回成功但没有报告正文；本次不扣积分");
    }
    return {
      model: DEEPSEEK_REPORT_MODEL,
      thinkingEnabled: DEEPSEEK_THINKING,
      text,
      reasoning: reasoning || null,
      usage,
      providerResponseId
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCredits() {
  await ensureData();
  const text = (await fs.readFile(TIKTOK_CREDITS_PATH, "utf8")).replace(/^\uFEFF/, "").trim();
  return text ? JSON.parse(text) : {};
}

async function writeCredits(value) {
  await fs.writeFile(TIKTOK_CREDITS_PATH, JSON.stringify(value, null, 2), "utf8");
}

function getReportUserId(req, payload = {}) {
  return String(req.headers["x-user-id"] || payload.userId || "local-user").trim() || "local-user";
}

function publicShop(shop) {
  return {
    id: shop.id,
    name: shop.name,
    region: shop.region,
    sellerType: shop.sellerType
  };
}

async function reportPreview(req, payload) {
  const type = reportType(payload.reportType || payload.type);
  const days = [1, 7, 30, 90].includes(Number(payload.days)) ? Number(payload.days) : 7;
  const query = new URLSearchParams({ days: String(days) });
  if (payload.endDate) query.set("end_date", String(payload.endDate));
  const analysis = await buildTikTokAnalysis(new URL(`http://internal/api/tiktok/shop-analysis?${query}`));
  const credits = await readCredits();
  const userId = getReportUserId(req, payload);
  const balance = Number(credits[userId]?.balance || 0);
  const cost = reportCost(type);
  const reportInput = buildReportInput(analysis, type);
  const prompt = reportPrompt(reportInput, { status: "pending_external_research" }, type);
  return {
    ok: true,
    userId,
    reportType: type,
    cost,
    balance,
    sufficientCredits: balance >= cost,
    ai: {
      provider: "DeepSeek",
      model: DEEPSEEK_REPORT_MODEL,
      thinkingEnabled: DEEPSEEK_THINKING,
      configured: Boolean(DEEPSEEK_API_KEY),
      estimatedInputTokens: estimateTokens(prompt),
      estimatedOutputTokens: type === "deep" ? 2200 : 1000,
      estimatedTotalTokens: estimateTokens(prompt) + (type === "deep" ? 2200 : 1000)
    },
    requiresConfirmation: true,
    analysis: {
      shop: analysis.shop,
      period: analysis.period,
      metrics: analysis.metrics,
      change: analysis.change,
      channels: analysis.channels,
      productCount: analysis.products.length,
      dataAvailability: analysis.dataAvailability,
      dataNotice: analysis.dataNotice
    }
  };
}

async function generateTikTokReport(req, payload) {
  payload = validateReportPayload(payload);
  if (payload.confirm !== true) throw new Error("必须先确认报告消耗后才能生成");
  if (!DEEPSEEK_API_KEY) throw new Error("未配置报告生成 AI API（DEEPSEEK_API_KEY）");
  const preview = await reportPreview(req, payload);
  if (!preview.sufficientCredits) throw new Error(`积分不足，需要 ${preview.cost} 积分，当前余额 ${preview.balance}`);
  const type = preview.reportType;
  const query = new URLSearchParams({ days: String(preview.analysis.period.days), end_date: preview.analysis.period.endDate });
  const analysis = await buildTikTokAnalysis(new URL(`http://internal/api/tiktok/shop-analysis?${query}`));
  const research = await researchShopContext(analysis);
  const reportInput = buildReportInput(analysis, type);
  const prompt = reportPrompt(reportInput, research, type);
  const ai = await callDeepSeekReport(prompt);
  const reportJson = validateReportOutput(ai.text);
  const credits = await readCredits();
  const userId = preview.userId;
  credits[userId] = { balance: Number(credits[userId]?.balance || 0) - preview.cost, updatedAt: new Date().toISOString() };
  await writeCredits(credits);
  const report = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    userId,
    reportType: type,
    cost: preview.cost,
    period: analysis.period,
    shop: analysis.shop,
    source: reportInput.source,
    researchMode: research.mode,
    output: ai.text,
    report: reportJson,
    ai: {
      provider: "DeepSeek",
      model: ai.model,
      thinkingEnabled: ai.thinkingEnabled,
      usage: ai.usage,
      estimatedInputTokens: estimateTokens(prompt),
      estimatedOutputTokens: estimateTokens(ai.text),
      estimatedTotalTokens: estimateTokens(prompt) + estimateTokens(ai.text)
    },
    dataAvailability: analysis.dataAvailability,
    dataNotice: analysis.dataNotice
  };
  const reports = await readJsonFile(TIKTOK_REPORTS_PATH);
  reports.unshift(report);
  await writeJsonFile(TIKTOK_REPORTS_PATH, reports, 100);
  return { ...report, remainingCredits: credits[userId].balance };
}

async function runTikTokReportJob(jobId, req, payload) {
  const job = tiktokReportJobs.get(jobId);
  if (!job) return;
  try {
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    job.startedAt = new Date().toISOString();
    await persistTikTokReportJobs();
    const result = await withTikTokStoreLock(() => generateTikTokReport(req, payload));
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    job.reportId = result.id;
    job.result = { id: result.id, reportType: result.reportType, ai: result.ai, remainingCredits: result.remainingCredits };
    await persistTikTokReportJobs();
  } catch (error) {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    job.error = error.message || "报告生成失败";
    await persistTikTokReportJobs();
  }
}

function reportJobPublic(job) {
  const { payload, ...publicJob } = job;
  return publicJob;
}

async function retryTikTokReportJob(jobId, req) {
  const current = tiktokReportJobs.get(jobId);
  if (!current) throw httpError("报告任务不存在或服务器已重启", 404);
  const userId = getReportUserId(req);
  if (current.userId !== userId) throw httpError("无权访问该报告任务", 403);
  if (current.status !== "failed") throw httpError("只有失败任务可以重试", 409);
  const retryId = randomUUID();
  const retry = {
    id: retryId,
    parentJobId: current.id,
    userId,
    status: "queued",
    createdAt: new Date().toISOString(),
    reportType: current.reportType,
    idempotencyKey: `${current.id}:retry:${retryId}`,
    payload: { ...current.payload, async: true, confirm: true }
  };
  tiktokReportJobs.set(retryId, retry);
  await persistTikTokReportJobs();
  void runTikTokReportJob(retryId, req, retry.payload);
  return reportJobPublic(retry);
}

async function readJsonFile(filePath) {
  await ensureData();
  const text = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "").trim();
  return text ? JSON.parse(text) : [];
}

async function readTikTokReportJobs() {
  const jobs = await readJsonFile(TIKTOK_REPORT_JOBS_PATH);
  return Array.isArray(jobs) ? jobs : [];
}

async function persistTikTokReportJobs() {
  await writeJsonFile(TIKTOK_REPORT_JOBS_PATH, [...tiktokReportJobs.values()], 500);
}

async function writeJsonFile(filePath, data, limit) {
  const value = Array.isArray(data) && limit ? data.slice(0, limit) : data;
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readPrompts() {
  await ensureData();
  const saved = await readJsonFile(PROMPTS_PATH);
  return {
    ...defaultPrompts,
    soulExtract: defaultSoulExtractPrompt(),
    soulRewrite: defaultSoulRewritePrompt(),
    builtInSoulRules: defaultBuiltInSoulRulesPrompt(),
    parameter_dual_material_retriever: defaultParameterDualMaterialRetrieverPromptCleanV2(),
    parameter_short_video_copywriter: defaultParameterShortVideoCopywriterPromptCleanV2(),
    topic_output_repair: defaultTopicOutputRepairPrompt(),
    ...saved
  };
}

async function savePrompts(prompts) {
  const merged = { ...(await readPrompts()), ...prompts };
  await writeJsonFile(PROMPTS_PATH, merged);
  await fs.writeFile(LEGACY_PROMPT_PATH, merged.rewrite || defaultPrompts.rewrite, "utf8");
  return merged;
}

function parseMaterialLibraryText(text) {
  const labelId = "\u7d20\u6750ID";
  const labelCopy = "\u539f\u59cb\u6587\u6848";
  const labelPlatform = "\u5e73\u53f0";
  const labelNiche = "\u8d5b\u9053";
  const labelRating = "\u7206\u6b3e\u7b49\u7ea7";
  const labelNotes = "\u5907\u6ce8";
  const labels = [labelPlatform, labelNiche, labelRating, labelNotes, labelId, labelCopy].join("|");
  const inferIndustryType = (value) => /跨境|电商|TikTok|TK|小店|商品机会|选品|店铺|出单|自然流|GMV|爆单符/i.test(String(value || "")) ? "同行业文案" : "跨行业文案";
  const blocks = String(text || "").split(/\n-{5,}\n/).map((item) => item.trim()).filter((item) => item.includes(labelId + "\uff1a"));
  return blocks.map((block, index) => {
    const pick = (label) => {
      const re = new RegExp(label + "\uff1a\\s*([\\s\\S]*?)(?=\\n(?:" + labels + ")\uff1a|$)");
      return (block.match(re)?.[1] || "").trim();
    };
    const id = pick(labelId) || String(index + 1).padStart(3, "0");
    const copy = pick(labelCopy);
    const platform = pick(labelPlatform) || "TikTok";
    const niche = pick(labelNiche) || "\u8de8\u5883";
    const rating = (pick(labelRating) || "A").replace("\u7ea7", "").trim() || "A";
    const notes = pick(labelNotes);
    const typeMatch = notes.match(/\u521b\u4f5c\u7c7b\u578b\uff1a([^\uff1b\n]+)/);
    const industryTypeMatch = notes.match(/文案行业类型[:：]([^；\n]+)/);
    const industryType = industryTypeMatch?.[1]?.trim() || inferIndustryType([copy, niche, notes].join("\n"));
    return {
      id: "material-" + id,
      source: "original",
      createdAt: "",
      copy,
      body: copy,
      platform,
      niche: niche.includes("\u8de8\u5883") ? "\u8de8\u5883" : niche.split(/[\/\uff0f,\uff0c]/)[0].trim(),
      rating,
      tags: typeMatch?.[1]?.trim() || "\u5e72\u8d27\u7c7b\u578b",
      industryType,
      notes
    };
  }).filter((item) => item.copy);
}

async function readMaterialLibrary() {
  const text = await readTextSafe(MATERIAL_PATH, 2000000);
  return parseMaterialLibraryText(text);
}

function parseForbiddenWordsCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const result = [];
  for (const line of lines.slice(1)) {
    const columns = line.split(",");
    const level = (columns[0] || "").trim().split(/\s+/)[0] || "P0";
    const category = (columns[1] || "").trim();
    const words = (columns[2] || "").split(/[、，,]/).map((item) => item.trim()).filter(Boolean);
    for (const word of words) result.push({ word, level, category });
  }
  return result;
}

async function readForbiddenWords() {
  const text = await readTextSafe(FORBIDDEN_WORDS_PATH, 200000);
  return parseForbiddenWordsCsv(text);
}

function extractMaterialSamples(text, rawContent, maxItems = 20) {
  const source = String(text || "");
  const raw = String(rawContent || "");
  const terms = [...new Set((raw.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2,}/g) || [])
    .filter((term) => term.length >= 2)
    .slice(0, 40))];
  const blocks = source.split(/\n-{5,}\n/).filter(Boolean);
  return blocks.map((block) => {
    let score = 0;
    for (const term of terms) if (block.includes(term)) score += term.length;
    if (/爆款等级[:：]\s*S/i.test(block)) score += 30;
    if (/爆款等级[:：]\s*A/i.test(block)) score += 12;
    return { block, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems)
    .map((item) => item.block)
    .join("\n-----\n");
}

async function loadContext(rawContent = "") {
  const prompts = await readPrompts();
  const memoryParts = await Promise.all(memoryFiles.map(async (file) => `\n### ${file}\n${await readTextSafe(file, 50000)}`));
  const materialText = await readTextSafe(MATERIAL_PATH, 700000);
  const originalMaterial = extractMaterialSamples(materialText, rawContent) || materialText.slice(-90000);
  const approvedMaterial = await readTextSafe(APPROVED_MATERIAL_PATH, 80000);
  return { prompts, memoryBundle: memoryParts.join("\n"), originalMaterial, approvedMaterial };
}

function buildBaseContext(ctx) {
  return [
    "<MEMORY>",
    ctx.memoryBundle,
    "</MEMORY>",
    "",
    "<ORIGINAL_MATERIAL_LIBRARY priority=\"highest_expression_only\">",
    ctx.originalMaterial,
    "</ORIGINAL_MATERIAL_LIBRARY>",
    "",
    "<APPROVED_USER_LIBRARY priority=\"secondary_preference_only\">",
    ctx.approvedMaterial,
    "</APPROVED_USER_LIBRARY>"
  ].join("\n");
}

function buildPrompt(payload, ctx) {
  const functionType = payload.functionType === "fission" ? "fission" : "rewrite";
  const activePrompt = functionType === "fission" ? ctx.prompts.fission : ctx.prompts.rewrite;
  return [
    activePrompt,
    "",
    "系统注入说明：素材库只能提供写法、节奏、开头逻辑，不能提供正文事实。",
    "必须严格遵守上方可编辑提示词的输出格式；如果上方提示词要求无标题，就不要输出标题；如果要求标题，就输出标题。",
    "",
    buildBaseContext(ctx),
    "",
    "最终内容边界：下面 RAW_CONTENT 才是这次唯一可写的事实来源。",
    "禁止使用素材库、历史记忆、示例里的任何主题、案例、数据、平台规则、经验结论作为正文事实。",
    "如果素材库事实和 RAW_CONTENT 不一致，必须丢弃素材库事实，只保留 RAW_CONTENT。",
    "质量硬门槛：不能缩水。RAW_CONTENT 里的关键人物、时间、结果、动作、问题、判断、例子、工具、细节必须全部覆盖。",
    "输出有效字数不得明显低于 RAW_CONTENT；宁可写长，也不能把完整逻辑压成摘要。",
    "如果你只是在删减、概括、顺滑原文，必须重写。",
    "",
    "<RAW_CONTENT priority=\"content_source_only\">",
    payload.rawContent || "",
    "</RAW_CONTENT>",
    "",
    "再次强调：只改写 RAW_CONTENT。不得输出解释、分析、匹配过程、自检、多版本。输出格式以上方可编辑提示词为准。"
  ].join("\n");
}

function sectionName(section) {
  return section === "body" ? "正文中段" : section === "ending" ? "结尾" : "开头";
}

function buildSectionPrompt(payload, ctx) {
  const prompts = ctx.prompts || {};
  const section = ["opening", "body", "ending"].includes(payload.section) ? payload.section : "opening";
  const promptMap = {
    opening: prompts.rewriteOpening || defaultPrompts.rewriteOpening,
    body: prompts.rewriteBody || defaultPrompts.rewriteBody,
    ending: prompts.rewriteEnding || defaultPrompts.rewriteEnding
  };
  const original = String(payload.output || "").trim();
  const rawContent = String(payload.rawContent || "").trim();
  return [
    promptMap[section],
    "",
    `本次只重构：${sectionName(section)}。`,
    "用户提示词如果要求输出全文，则输出全文；否则只输出被重构的部分。",
    "必须只基于 RAW_CONTENT 和 CURRENT_COPY，不得新增不存在的事实、案例、数字、工具或承诺。",
    "",
    "<RAW_CONTENT>",
    rawContent,
    "</RAW_CONTENT>",
    "",
    "<CURRENT_COPY>",
    original,
    "</CURRENT_COPY>",
    "",
    "输出要求：只输出重构结果，不要解释、不要分析、不要多版本。"
  ].join("\n");
}

function normalizeSectionCompare(text) {
  return String(text || "").replace(/^标题[:：].*$/gm, "").replace(/\s+/g, "");
}

function sectionUnchanged(section, originalOutput, nextOutput) {
  const oldText = normalizeSectionCompare(originalOutput);
  const newText = normalizeSectionCompare(nextOutput);
  if (!oldText || !newText) return false;
  if (oldText === newText) return true;
  const oldTarget = normalizeSectionCompare(targetSectionFromCopy(originalOutput, section));
  const newTarget = normalizeSectionCompare(targetSectionFromCopy(nextOutput, section) || nextOutput);
  return Boolean(oldTarget && newTarget && oldTarget === newTarget);
}

function targetSectionFromCopy(output, section) {
  const body = String(output || "").replace(/^标题[:：].*$/gm, "").trim();
  const paragraphs = body.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (!paragraphs.length) return body;
  if (section === "opening") return paragraphs[0] || "";
  if (section === "ending") return paragraphs[paragraphs.length - 1] || "";
  return paragraphs.slice(1, -1).join("\n\n") || paragraphs.slice(1).join("\n\n") || body;
}

function buildSectionRetryPrompt(prompt, section, originalOutput, badOutput) {
  return [
    prompt,
    "",
    "上一次重构变化不明显，必须重新写。",
    `目标部分：${sectionName(section)}。`,
    "不要只换词，不要保留原句式，不要照着原文顺序轻改。",
    "保持事实不变，但表达角度、句式节奏、段落推进必须明显变化。",
    "",
    "<BAD_OUTPUT>",
    badOutput || "",
    "</BAD_OUTPUT>",
    "",
    "重新输出。"
  ].join("\n");
}

function normalizeTopicParamsClean(payload = {}) {
  const target = Number(payload.targetWordCount || payload.target_word_count || 900);
  return {
    topic: String(payload.topic || "").trim(),
    conditions: String(payload.conditions || "").trim(),
    targetWordCount: Math.min(1500, Math.max(300, Number.isFinite(target) ? target : 900)),
    copyStyle: String(payload.copyStyle || payload.copy_style || "清醒实战型").trim() || "清醒实战型",
    hookType: String(payload.hookType || payload.hook_type || "扎心共情型").trim() || "扎心共情型",
    copyType: String(payload.copyType || payload.copy_type || "思维型").trim() || "思维型",
    isLeadGen: Boolean(payload.isLeadGen ?? payload.is_lead_gen ?? false),
    leadGenGoal: String(payload.leadGenGoal || payload.lead_gen_goal || "").trim(),
    leadGenKeyword: String(payload.leadGenKeyword || payload.lead_gen_keyword || "").trim(),
    debug: Boolean(payload.debug),
    soul: payload.soul || null,
    soulRewrite: Boolean(payload.soulRewrite)
  };
}

function topicKeywordPackClean(topic, conditions = "", copyType = "思维型") {
  const text = `${topic}\n${conditions}`;
  const packs = [
    [/开店|入驻|新手起步|起店/, ["开店", "入驻", "注册", "保证金", "新店", "起店", "平台规则", "店铺搭建", "收款", "物流"]],
    [/选品|爆品|蓝海/, ["选品", "新品", "爆品", "蓝海", "销量", "上架时间", "同行", "价格带", "利润", "平台热榜"]],
    [/商品卡|商品优化/, ["商品卡", "标题", "主图", "价格", "折扣", "卖点", "详情页", "点击率", "曝光", "转化"]],
    [/主图|封面图|图片/, ["主图", "封面图", "商品卡", "点击率", "第一眼", "曝光", "转化", "场景图", "卖点图", "同行对比"]],
    [/标题|关键词|SEO/, ["标题", "关键词", "搜索词", "热词", "长尾词", "SEO", "搜索流量", "标题权重", "品牌词", "违禁词"]],
    [/定价|价格|利润/, ["定价", "利润", "成本", "运费", "佣金", "折扣", "售价", "价格带", "毛利", "亏损"]],
    [/流量|自然流|推荐流|搜索流/, ["流量", "自然流", "推荐流", "搜索流", "曝光", "点击", "转化", "商品卡流量", "冷启动", "权重"]],
    [/达人|联盟|寄样/, ["达人", "联盟", "寄样", "纯佣", "GMV", "播放量", "互动率", "佣金", "达人筛选", "样品"]],
    [/体验分|店铺健康|差评/, ["体验分", "店铺评分", "履约", "发货", "物流", "差评", "退款", "客服", "活动报名", "流量限制"]],
    [/侵权|合规|风险|违规/, ["侵权", "品牌词", "违禁词", "敏感词", "违规", "封店", "下架", "平台规则", "商品合规"]],
    [/商机|提报|热词/, ["商机", "商机词", "提报", "关键词", "热词", "商品机会", "AI插词", "标题匹配", "通过率"]],
    [/活动|促销|折扣|秒杀/, ["活动", "报名", "促销", "折扣", "优惠券", "秒杀", "活动价", "转化", "流量", "利润"]],
    [/物流|履约|发货/, ["物流", "发货", "履约", "时效", "延迟发货", "退款", "货代", "运费", "妥投", "售后"]],
    [/爆单|起量|放量/, ["爆单", "起量", "放量", "冷启动", "自然流", "商品卡", "转化", "点击率", "复盘"]]
  ];
  const found = packs.find(([re]) => re.test(text));
  const base = found ? found[1] : [];
  const own = (text.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2,}/g) || []).filter((item) => item.length >= 2);
  const typeKeywords = copyType === "思维型"
    ? ["趋势", "未来", "风口", "行业情况", "行业变化", "行业现实", "为什么", "适不适合", "坚持", "机会", "淘汰", "门槛", "利润", "竞争", "普通人", "新手", "判断", "认知"]
    : ["商品机会", "商品卡", "GMV", "主图", "标题", "定价", "提报", "数据罗盘", "自然流", "推荐流量", "搜索流量", "点击率", "转化率", "上架", "店铺运营", "工具", "步骤", "执行"];
  const platformKeywords = isCrossBorderTopicClean(text) ? ["TK", "TikTok", "TikTok Shop", "跨境", "小店"] : [];
  return [...new Set([...own, ...base, ...typeKeywords, ...platformKeywords])].slice(0, 45);
}

function isCrossBorderTopicClean(text = "") {
  return /TK|TikTok|TikTok Shop|跨境|小店|电商|商品卡|选品|主图|标题|定价|自然流|商机|提报|达人|GMV|爆单|店铺|开店/i.test(String(text || ""));
}

function materialIsCrossBorderClean(item = {}) {
  return /TK|TikTok|TikTok Shop|跨境|小店|电商|商品卡|选品|主图|标题|定价|自然流|商机|提报|达人|GMV|爆单|店铺|开店/i.test([item.copy, item.niche, item.tags, item.notes].join("\n"));
}

function styleKeywordPackClean(copyStyle, hookType, isLeadGen, copyType = "思维型") {
  const styleMap = {
    "清醒实战型": ["经验复盘", "直接判断", "问题拆解", "少废话", "实战口播"],
    "犀利避坑型": ["错误开头", "踩坑提醒", "反常识", "后果放大", "纠错路径"],
    "老板视角型": ["投入产出", "利润判断", "经营决策", "成本意识", "效率对比"],
    "新手听得懂型": ["简单解释", "一步一步", "少术语", "先讲现象", "具体动作"],
    "冷静拆解型": ["流程拆解", "判断标准", "分层说明", "因果推进", "清晰收束"],
    "口语成交型": ["真人口播", "轻转化", "评论引导", "私信引导", "行动钩子"]
  };
  const hookMap = {
    "扎心共情型": ["用户烦恼", "踩坑经历", "难处共情", "常见错误", "直接戳问题"],
    "结果反差型": ["前后对比", "结果反差", "逆转", "同样条件不同结果"],
    "命令指令型": ["停下", "别急", "先别做", "赶紧检查", "强提醒"],
    "悬念好奇型": ["没人告诉你", "真正原因", "很多人不知道", "表面问题背后"],
    "数据直击型": ["数字开头", "数据对比", "真实比例", "真实变化", "数量表达"],
    "身份立场型": ["人群筛选", "圈层定位", "如果你是", "真正想做好"]
  };
  const typeMap = {
    "思维型": ["行业判断", "现实拆解", "趋势判断", "风口变化", "为什么还做", "坚持理由", "认知纠偏", "人群筛选", "机会判断", "清醒观点"],
    "实战型": ["实操步骤", "专业名词", "后台动作", "商品机会", "商品卡", "GMV", "主图优化", "标题优化", "提报", "数据反馈"]
  };
  return [...new Set([
    ...(styleMap[copyStyle] || styleMap["清醒实战型"]),
    ...(hookMap[hookType] || hookMap["扎心共情型"]),
    ...(typeMap[copyType] || typeMap["思维型"]),
    ...(isLeadGen ? ["评论关键词", "私信关键词", "领取资料", "清单", "表格", "工具", "模板", "案例拆解"] : [])
  ])];
}

function scoreMaterialClean(item, keywords, options = {}) {
  const hay = [item.copy, item.niche, item.tags, item.notes].join("\n");
  let score = 0;
  for (const key of keywords) if (key && hay.includes(key)) score += String(key).length + 3;
  if (item.rating === "S") score += 18;
  if (item.rating === "A") score += 8;
  if (options.industry && /跨境|电商|TikTok|TK|小店|商品卡|主图|选品|标题|定价|自然流|达人|商机|爆单/i.test(hay)) score += 25;
  if (options.style && !/跨境|TikTok|TK小店|TikTok Shop/.test(hay)) score += 10;
  return score;
}

function materialExcerpt(item, max = 520) {
  return String(item.copy || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function formatCandidateMaterialsClean(items) {
  return items.map((item, index) => [
    `候选${index + 1}`,
    `素材ID：${item.id}`,
    `赛道：${item.niche}`,
    `评级：${item.rating}`,
    `类型：${item.tags}`,
    `行业类型：${item.industryType || ""}`,
    `原文片段：${materialExcerpt(item, 700)}`
  ].join("\n")).join("\n\n---\n\n");
}

function renderTemplate(template, values) {
  return String(template || "").replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => values[key] ?? "");
}

function buildTopicRetrieverPrompt(params, materialPath, industryCandidates, styleCandidates, promptTemplate) {
  return renderTemplate(promptTemplate || defaultParameterDualMaterialRetrieverPromptCleanV2(), {
    USER_TOPIC: params.topic,
    USER_CONDITIONS: params.conditions,
    TARGET_WORD_COUNT: String(params.targetWordCount),
    COPY_STYLE: params.copyStyle,
    HOOK_TYPE: params.hookType,
    COPY_TYPE: params.copyType,
    IS_LEAD_GEN: String(params.isLeadGen),
    LEAD_GEN_GOAL: params.leadGenGoal,
    LEAD_GEN_KEYWORD: params.leadGenKeyword,
    MATERIAL_PATH: materialPath,
    MATERIAL_LIBRARY_PATH: materialPath,
    CANDIDATE_MATERIALS: [
      "【行业内容候选】",
      formatCandidateMaterialsClean(industryCandidates),
      "",
      "【跨行业结构候选】",
      formatCandidateMaterialsClean(styleCandidates)
    ].join("\n"),
    INDUSTRY_CANDIDATES: formatCandidateMaterialsClean(industryCandidates),
    STYLE_CANDIDATES: formatCandidateMaterialsClean(styleCandidates)
  });
}

function buildTopicCopywriterPrompt(params, materialJson, promptTemplate) {
  return renderTemplate(promptTemplate || defaultParameterShortVideoCopywriterPromptCleanV2(), {
    USER_TOPIC: params.topic,
    USER_CONDITIONS: params.conditions,
    MATERIAL_JSON: JSON.stringify(materialJson, null, 2)
  });
}

function countCopyChars(text) {
  return String(text || "").replace(/\s/g, "").length;
}

function topicLengthRange(targetWordCount) {
  const target = Math.min(1500, Math.max(300, Number(targetWordCount) || 900));
  return {
    target,
    min: Math.max(1, Math.floor(target * 0.85)),
    max: Math.min(1500, Math.ceil(target * 1.15))
  };
}

function topicOutputIssues(params, text) {
  const value = String(text || "").trim();
  const length = countCopyChars(value);
  const range = topicLengthRange(params.targetWordCount);
  const issues = [];
  if (/^标题[:：]/m.test(value)) issues.push("输出了标题，但话题生文只允许正文");
  if (length < range.min) issues.push(`字数不足，当前 ${length} 字，目标区间 ${range.min}-${range.max} 字`);
  if (length > range.max) issues.push(`字数超出，当前 ${length} 字，目标区间 ${range.min}-${range.max} 字`);
  if (params.isLeadGen && params.leadGenKeyword && !value.includes(params.leadGenKeyword)) issues.push(`开启引流但结尾没有出现关键词：${params.leadGenKeyword}`);
  return issues;
}

function defaultTopicOutputRepairPrompt() {
  return String.raw`你是「话题生文输出修复器」。

任务：根据错误原因，重写上一版话题生文结果。

硬规则：
1. 只输出正文，不要标题，不要小标题，不要解释。
2. 必须遵守 MATERIAL_JSON.generation_params。
3. 必须围绕 USER_TOPIC，不得把无关素材库行业案例写进正文。
4. 素材库只能提供表达结构，不能提供正文事实。
5. 如果选择了灵魂重塑，灵魂重塑会在本步骤之后执行；本步骤只负责参数、字数、引流和主题边界。
6. 如果 ISSUES 里提示字数不足，必须扩写到目标区间内，不要只补一两句。
7. 扩写只能围绕 USER_TOPIC 和 USER_CONDITIONS，把现有观点讲透，不能引入无关行业案例。
8. 如果文案类型是「思维型」，扩写现实判断、趋势判断、人群判断、选择代价和行动理由。
9. 如果文案类型是「实战型」，扩写步骤、判断标准、执行细节和注意事项。
10. 输出前自行计算正文有效字数，低于目标区间就继续扩写，高于目标区间就压缩。

USER_TOPIC：
{{USER_TOPIC}}

USER_CONDITIONS：
{{USER_CONDITIONS}}

ISSUES：
{{ISSUES}}

MATERIAL_JSON：
{{MATERIAL_JSON}}`;
}

async function enforceTopicOutput(params, materialJson, currentText, promptTemplate, repairTemplate) {
  const issues = topicOutputIssues(params, currentText);
  if (!issues.length) return { text: currentText, repaired: false, issues: [] };

  const range = topicLengthRange(params.targetWordCount);
  const issueText = [
    issues.map((item) => "- " + item).join("\n"),
    `目标字数区间：${range.min}-${range.max} 字，目标 ${range.target} 字。`,
    `文案风格：${params.copyStyle}`,
    `黄金三秒：${params.hookType}`,
    `文案类型：${params.copyType}`,
    params.isLeadGen
      ? `引流要求：目的 ${params.leadGenGoal || "轻引导"}，关键词 ${params.leadGenKeyword || "无指定关键词"}。`
      : "引流要求：未开启引流，不要强行引流。"
  ].join("\n");
  const prompt = renderTemplate(repairTemplate || defaultTopicOutputRepairPrompt(), {
    USER_TOPIC: params.topic,
    USER_CONDITIONS: params.conditions,
    ISSUES: issueText,
    MATERIAL_JSON: JSON.stringify(materialJson, null, 2)
  });

  const result = await callHermesClean(prompt);
  const repairedText = String(result.text || "").trim();
  return {
    text: repairedText || currentText,
    repaired: Boolean(repairedText),
    issues
  };
}

function buildLocalMaterialJson(params, industryCandidates, styleCandidates) {
  const styleKeywords = styleKeywordPackClean(params.copyStyle, params.hookType, params.isLeadGen, params.copyType);
  const topicCard = {
    card_id: "C0",
    source_file: "USER_TOPIC",
    related_topic: params.topic,
    usable_point: [
      `用户话题：${params.topic}`,
      params.conditions ? `用户条件：${params.conditions}` : "",
      `文案类型：${params.copyType}`,
      `文案风格：${params.copyStyle}`,
      `黄金三秒：${params.hookType}`
    ].filter(Boolean).join("；"),
    usable_steps: [],
    usable_judgment: params.copyType === "思维型"
      ? ["围绕用户话题做现实判断、趋势判断、人群判断和原因拆解，不把素材库里的行业案例当事实。"]
      : ["围绕用户话题整理可执行动作，不能新增用户未给出且素材未支撑的方法。"],
    usable_warning: ["不要把无关素材库内容写进正文。"],
    usable_data: (String(params.topic + "\n" + params.conditions).match(/\d+(?:\.\d+)?%?|\d+\s*(?:年|月|天|单|个|倍)/g) || []).slice(0, 6),
    source_excerpt: [params.topic, params.conditions].filter(Boolean).join("\n")
  };
  const materialIndustryCards = industryCandidates.slice(0, 5).map((item, index) => ({
    card_id: `C${index + 1}`,
    source_file: path.basename(MATERIAL_PATH),
    related_topic: item.niche || params.topic,
    usable_point: materialExcerpt(item, 160),
    usable_steps: (materialExcerpt(item, 260).match(/第[一二三四五六七八九十]步[^。！？\n]*|先[^。！？\n]*|然后[^。！？\n]*|最后[^。！？\n]*/g) || []).slice(0, 4),
    usable_judgment: (materialExcerpt(item, 260).match(/不是[^。！？\n]*|问题[^。！？\n]*|核心[^。！？\n]*|关键[^。！？\n]*|真正[^。！？\n]*/g) || []).slice(0, 4),
    usable_warning: (materialExcerpt(item, 260).match(/别[^。！？\n]*|不要[^。！？\n]*|风险[^。！？\n]*|亏[^。！？\n]*|错[^。！？\n]*/g) || []).slice(0, 4),
    usable_data: (materialExcerpt(item, 260).match(/\d+(?:\.\d+)?%?|\d+\s*(?:天|单|个|刀|元|倍)/g) || []).slice(0, 5),
    source_excerpt: materialExcerpt(item, 700)
  }));
  const industryCards = [topicCard, ...materialIndustryCards];
  const styleCards = styleCandidates.slice(0, 4).map((item, index) => ({
    card_id: `S${index + 1}`,
    source_file: path.basename(MATERIAL_PATH),
    source_industry: item.niche || item.tags || "素材库",
    matched_copy_style: params.copyStyle,
    matched_hook_type: params.hookType,
    style_type: params.isLeadGen && index === 0 ? "引流承接" : index === 0 ? "黄金三秒" : "句子节奏",
    usable_structure: styleKeywords.slice(0, 6).join(" / "),
    hook_pattern: params.hookType,
    progression_pattern: "先指出错误认知，再拆原因，再给动作。",
    ending_pattern: params.isLeadGen ? "结尾轻引导关键词，不承诺结果。" : "结尾用结果归因收住。",
    lead_gen_pattern: params.isLeadGen ? `围绕“${params.leadGenKeyword || "关键词"}”做轻引导。` : "",
    sentence_rhythm: "短句推进，段落不要过长，口播感优先。",
    source_excerpt: materialExcerpt(item, 520)
  }));
  const overall = industryCards.length >= 1 && styleCards.length >= 1 ? "PASS" : "FAIL";
  return {
    overall_status: overall,
    coverage_reason: overall === "PASS" ? "用户话题已作为内容边界，素材库只提供可参考的写法结构。" : "当前命中素材不足以支撑这个选题。",
    user_topic: params.topic,
    user_conditions: params.conditions,
    generation_params: {
      target_word_count: String(params.targetWordCount),
      copy_style: params.copyStyle,
      hook_type: params.hookType,
      copy_type: params.copyType,
      is_lead_gen: String(params.isLeadGen),
      lead_gen_goal: params.leadGenGoal,
      lead_gen_keyword: params.leadGenKeyword
    },
    topic_analysis: {
      topic_type: "本地检索型",
      expanded_industry_keywords: topicKeywordPackClean(params.topic, params.conditions, params.copyType),
      expanded_style_keywords: styleKeywords,
      expanded_hook_keywords: styleKeywords.slice(0, 8),
      expanded_lead_gen_keywords: params.isLeadGen ? ["评论关键词", "私信关键词", params.leadGenKeyword].filter(Boolean) : []
    },
    content_coverage: { status: industryCards.length >= 1 ? "PASS" : "FAIL", available_angles: industryCards.map((card) => card.related_topic).slice(0, 6), missing_angles: [] },
    style_coverage: { status: styleCards.length >= 1 ? "PASS" : "FAIL", available_style_patterns: styleCards.map((card) => card.usable_structure).slice(0, 4), missing_style_patterns: [] },
    hook_coverage: { status: "PASS", selected_hook_type: params.hookType, available_hook_patterns: styleCards.map((card) => card.hook_pattern), hook_risk: "" },
    lead_gen_coverage: { status: params.isLeadGen ? "PASS" : "NOT_REQUIRED", available_lead_gen_patterns: params.isLeadGen ? styleCards.map((card) => card.lead_gen_pattern).filter(Boolean) : [], lead_gen_risk: params.isLeadGen && !params.leadGenKeyword ? "未填写关键词，只能轻引导。" : "" },
    industry_content_cards: industryCards,
    cross_industry_style_cards: styleCards,
    generation_instruction: {
      content_rule: "下一步只能用 industry_content_cards 决定行业内容",
      style_rule: "下一步只能用 cross_industry_style_cards 学习写法结构，不能搬运跨行业事实",
      parameter_rule: "下一步必须遵守 generation_params",
      if_fail: "如果 overall_status = FAIL，下一步不应生成文案"
    }
  };
}

async function validateMaterialPath() {
  if (!MATERIAL_PATH) throw new Error("素材库路径无效：无法生成素材卡");
  try {
    await fs.access(MATERIAL_PATH);
    const text = await readTextSafe(MATERIAL_PATH, 1000);
    if (!text || text.startsWith("[[READ_FAILED")) throw new Error("read failed");
  } catch {
    throw new Error("素材库路径无效：无法生成素材卡");
  }
}

async function runCopywritingPipeline(rawPayload = {}) {
  const params = normalizeTopicParamsClean(rawPayload);
  if (!params.topic) throw new Error("话题不能为空");
  await validateMaterialPath();
  const prompts = await readPrompts();
  const materials = await readMaterialLibrary();
  const industryKeywords = topicKeywordPackClean(params.topic, params.conditions, params.copyType);
  const styleKeywords = styleKeywordPackClean(params.copyStyle, params.hookType, params.isLeadGen, params.copyType);
  const topicIsCrossBorder = isCrossBorderTopicClean(`${params.topic}\n${params.conditions}`);
  params._allowShortWhenTopicOnly = !topicIsCrossBorder;
  const industryCandidates = topicIsCrossBorder ? materials
    .map((item) => ({ ...item, _score: scoreMaterialClean(item, industryKeywords, { industry: true }) }))
    .filter((item) => item._score > 0)
    .filter((item) => topicIsCrossBorder || !materialIsCrossBorderClean(item))
    .sort((a, b) => b._score - a._score)
    .slice(0, 10) : [];
  const styleCandidates = materials
    .map((item) => ({ ...item, _score: scoreMaterialClean(item, styleKeywords, { style: true }) }))
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);
  const materialJson = buildLocalMaterialJson(params, industryCandidates, styleCandidates);
  const stepAPrompt = buildTopicRetrieverPrompt(params, MATERIAL_PATH, industryCandidates, styleCandidates, prompts.parameter_dual_material_retriever || defaultParameterDualMaterialRetrieverPromptCleanV2());
  const stepAResult = { mode: "local", text: JSON.stringify(materialJson, null, 2), prompt: stepAPrompt };
  if (materialJson.overall_status === "FAIL") {
    const failText = "当前命中素材不足以支撑这个选题，请补充更多相关文案素材后再生成。";
    return params.debug ? {
      params,
      material_path: MATERIAL_PATH,
      step_a_raw_output: stepAResult.text,
      material_json: materialJson,
      industry_content_cards: materialJson.industry_content_cards || [],
      cross_industry_style_cards: materialJson.cross_industry_style_cards || [],
      final_copy_text: failText
    } : { final_copy_text: failText };
  }
  const stepBPrompt = buildTopicCopywriterPrompt(params, materialJson, prompts.parameter_short_video_copywriter);
  let stepBResult = await callHermesClean(stepBPrompt);
  let finalText = String(stepBResult.text || "").trim();
  const enforced = await enforceTopicOutput(params, materialJson, finalText, prompts.parameter_short_video_copywriter, prompts.topic_output_repair);
  finalText = enforced.text;
  const preSoulText = String(finalText || "").trim();
  if (params.soulRewrite) {
    const soulResult = await applySoulRewrite({
      rawContent: `${params.topic}\n${params.conditions}`,
      soulRewrite: true,
      soul: params.soul
    }, { text: finalText, mode: stepBResult.mode, prompt: stepBPrompt });
    finalText = String(soulResult.text || finalText).trim();
    const postSoulEnforced = await enforceTopicOutput(params, materialJson, finalText, prompts.parameter_short_video_copywriter, prompts.topic_output_repair);
    if (postSoulEnforced.repaired) {
      const secondSoulResult = await applySoulRewrite({
        rawContent: `${params.topic}\n${params.conditions}`,
        soulRewrite: true,
        soul: params.soul
      }, { text: postSoulEnforced.text, mode: stepBResult.mode, prompt: stepBPrompt });
      const secondSoulText = String(secondSoulResult.text || "").trim();
      const range = topicLengthRange(params.targetWordCount);
      finalText = countCopyChars(secondSoulText) >= range.min
        ? secondSoulText
        : String(postSoulEnforced.text || finalText).trim();
    }
  }
  let finalIssues = topicOutputIssues(params, finalText);
  let finalRepairCount = 0;
  while (finalIssues.length && finalRepairCount < 2) {
    const finalEnforced = await enforceTopicOutput(params, materialJson, finalText, prompts.parameter_short_video_copywriter, prompts.topic_output_repair);
    finalText = String(finalEnforced.text || finalText).trim();
    finalIssues = topicOutputIssues(params, finalText);
    finalRepairCount += 1;
  }
  if (finalIssues.length) {
    const range = topicLengthRange(params.targetWordCount);
    if (countCopyChars(finalText) < range.min && countCopyChars(preSoulText) >= range.min) {
      finalText = preSoulText;
      finalIssues = topicOutputIssues(params, finalText);
    }
  }
  const outputIssues = topicOutputIssues(params, finalText);
  const result = {
    params,
    material_path: MATERIAL_PATH,
    step_a_raw_output: stepAResult.text,
    material_json: materialJson,
    industry_content_cards: materialJson.industry_content_cards || [],
    cross_industry_style_cards: materialJson.cross_industry_style_cards || [],
    final_copy_text: finalText,
    validation: {
      target_range: topicLengthRange(params.targetWordCount),
      actual_word_count: countCopyChars(finalText),
      repaired: Boolean(enforced.repaired || finalRepairCount),
      issues: outputIssues
    }
  };
  return params.debug ? result : { final_copy_text: finalText };
}

function cleanHermesText(text) {
  const raw = String(text || "").trim();
  const matches = [...raw.matchAll(/^标题[:：]/gm)];
  if (!matches.length) return raw;
  return raw.slice(matches[matches.length - 1].index).trim();
}

function isContaminatedOutput(text) {
  const value = String(text || "");
  return /试用码|卡密|REST|RE7HPTCM09|CKZT7P39VM|大哥好|操作要点|全球站点支持|请随时联系/.test(value);
}

function effectiveChineseLength(text) {
  return String(text || "").replace(/^标题[:：].*$/gm, "").replace(/\s/g, "").length;
}

function isShrunkOutput(rawContent, output) {
  const rawLength = effectiveChineseLength(rawContent);
  const outputLength = effectiveChineseLength(output);
  if (rawLength < 240) return false;
  if (rawLength <= 1800) return outputLength < Math.floor(rawLength * 0.75);
  return outputLength < 1200;
}

function normalizeDuplicateText(text) {
  return String(text || "")
    .replace(/^标题[:：].*$/gm, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .toLowerCase();
}

function duplicateRateAgainstRaw(rawContent, output) {
  const raw = normalizeDuplicateText(rawContent);
  const value = normalizeDuplicateText(output);
  if (!raw || !value) return 0;
  if (value.length < 16) return raw.includes(value) ? 100 : 0;
  const size = value.length >= 80 ? 4 : 2;
  const rawSet = new Set();
  for (let i = 0; i <= raw.length - size; i += 1) rawSet.add(raw.slice(i, i + size));
  let total = 0;
  let hit = 0;
  for (let i = 0; i <= value.length - size; i += 1) {
    total += 1;
    if (rawSet.has(value.slice(i, i + size))) hit += 1;
  }
  return total ? Math.round((hit / total) * 100) : 0;
}

function isTooSimilarOutput(rawContent, output) {
  const rawLength = effectiveChineseLength(rawContent);
  if (rawLength < 120) return false;
  return duplicateRateAgainstRaw(rawContent, output) >= 82;
}

function isValidCopyOutput(text, rawContent = "") {
  const value = String(text || "").trim();
  if (isContaminatedOutput(value)) return false;
  if (value.length < 60) return false;
  if (isShrunkOutput(rawContent, value)) return false;
  if (isTooSimilarOutput(rawContent, value)) return false;
  return true;
}

function invalidCopyReason(rawContent, output) {
  if (isContaminatedOutput(output)) return "输出混入了试用码、卡密、客服话术或历史对话内容";
  if (String(output || "").trim().length < 60) return "输出为空或过短";
  if (isShrunkOutput(rawContent, output)) {
    return `输出明显缩水：原文有效字数 ${effectiveChineseLength(rawContent)}，输出有效字数 ${effectiveChineseLength(output)}`;
  }
  if (isTooSimilarOutput(rawContent, output)) {
    return `输出与原文过于相似：查重率 ${duplicateRateAgainstRaw(rawContent, output)}%，属于原文顺序搬运或轻微改词`;
  }
  return "输出格式不合格";
}

function buildRepairPrompt(rawContent, badOutput, reason = "") {
  return [
    "上一次输出不合格，必须完全丢弃。",
    reason ? `不合格原因：${reason}` : "",
    "禁止输出试用码、卡密、软件说明、客服话术、对话内容、历史记录、REST、RE7HPTCM09、CKZT7P39VM。",
    "你现在只处理下面 RAW_CONTENT。只输出最终文案正文，不要解释。",
    "必须完整覆盖 RAW_CONTENT 的关键细节，不能删减，不能摘要，不能只保留前半段。",
    "输出有效字数不得明显低于 RAW_CONTENT。宁可写长，不能缩水。",
    "禁止沿用 RAW_CONTENT 的段落顺序和句子骨架。",
    "禁止只替换词语、只删减、只压缩。",
    "必须先拆事实颗粒，再重新组织成新的口播逻辑。",
    "输出和 RAW_CONTENT 的查重率必须明显降低，不能看起来像原文轻改。",
    "素材库只学习写法，不允许带入素材库事实。",
    "",
    "<RAW_CONTENT>",
    rawContent || "",
    "</RAW_CONTENT>",
    "",
    "<BAD_OUTPUT_DO_NOT_USE>",
    String(badOutput || "").slice(0, 1200),
    "</BAD_OUTPUT_DO_NOT_USE>"
  ].join("\n");
}

function defaultSoulRewritePrompt() {
  return String.raw`你是「写作灵魂重塑器」。

任务：基于给定的人格规则，把 BASE_DRAFT 重塑成更接近该人格的中文口播文案。

硬规则：
1. RAW_CONTENT 是唯一事实边界，不能新增工具、路径、承诺、结果、价格、案例。
2. BASE_DRAFT 只提供事实和主逻辑，不提供必须保留的表达结构；人格规则必须真正接管表达、节奏、断句、开头、推进和结尾。
3. 如果人格规则和事实准确冲突，优先事实准确。
4. 禁止输出解释、分析、自检、JSON、markdown。
5. 绝对不要输出标题，不要输出“标题：”，不要新增任何标题行。
6. 只输出正文内容。

重塑强度：
- 不能只是把 BASE_DRAFT 换几个词。
- 不能保留 BASE_DRAFT 的教程腔、商业拆解腔、标准三段论。
- 可以重排句子和段落，只要不新增事实。
- 如果 SOUL_RULES 明确规定某种句式、断句、叙事方式，必须优先执行。
- 最终结果必须一眼能看出被当前灵魂重塑过，而不是普通文案润色。

如果 SOUL_RULES 是余华人格灵魂，额外执行：
1. 禁止写成商业演讲、认知课、方法论课。
2. 禁止使用：第一条、第二条、第三条、我直接告诉你、真正的壁垒、认知套利、效率碾压、内容杠杆、改命的核心逻辑、起跑线拉平、机会只奖赏。
3. 少用抽象判断，多写动作、场景、停顿和沉默。
4. 句子要短。可以大量换行。
5. 多用“后来”“然后”“就”，少用形容词。
6. 不要解释人物有多痛、压力有多大，要让事情自己发生。
7. 不能凭空编造具体人物、时间、收入、订单、项目案例；没有事实时，就围绕 RAW_CONTENT 的问题写普通人的状态。
8. SOUL_RULES 里的示例只用于学习写法，严禁复制示例里的人名、行业、公司、仓库、物流、订单、工具、收入和具体场景。

<RAW_CONTENT>
{{rawContent}}
</RAW_CONTENT>

<BASE_DRAFT>
{{baseDraft}}
</BASE_DRAFT>

<SOUL_RULES>
{{soulRules}}
</SOUL_RULES>`;
}

function defaultSoulExtractPrompt() {
  return String.raw`你是一个写作人格灵魂分析引擎。

你只分析作者怎么写，不分析文案主题和行业知识点。
必须输出 JSON，不要 markdown，不要解释。

分析重点：句长、断句、标点、排版、口语化程度、AI味、转折方式、攻击性、开头方式、结尾方式、高频表达、禁忌表达。

输出格式：
{
  "soul_summary": "200字内的人格灵魂总结",
  "soul_tags": [],
  "style_consistency_score": "",
  "dominant_style": "",
  "originality_score": "",
  "personality_strength": "",
  "writing_rules": {
    "avg_sentence_length": "",
    "sentence_style": "",
    "paragraph_break_rate": "",
    "single_line_paragraph_rate": "",
    "question_density": "",
    "transition_strength": "",
    "emotion_strength": "",
    "pressure_level": "",
    "attack_level": "",
    "oral_level": "",
    "formal_language_ratio": "",
    "teaching_tendency": "",
    "summary_tendency": "",
    "ai_smell_score": "",
    "emotion_authenticity": "",
    "opening_style": [],
    "ending_style": [],
    "preferred_words": [],
    "preferred_phrases": [],
    "preferred_transition_words": [],
    "preferred_sentence_patterns": [],
    "disliked_patterns": [],
    "punctuation_style": {
      "comma_type": "",
      "comma_density": "",
      "period_density": "",
      "ellipsis_usage": "",
      "exclamation_usage": "",
      "question_mark_usage": "",
      "line_break_style": "",
      "english_punctuation_ratio": "",
      "emoji_usage": "",
      "emoji_style": ""
    }
  }
}

用户文案：
{{contents}}`;
}

function defaultBuiltInSoulRulesPrompt() {
  return String.raw`# 马斯克人格灵魂

你不是在“写内容”。
你是在：重新定义世界运行方式。

核心人格：
- 极度目标导向
- 极度理性
- 极度结果主义
- 不相信传统规则
- 习惯拆解世界本质
- 喜欢挑战“不可能”
- 不接受低效率
- 不接受无意义流程
- 认为大部分问题都可以被重构

看待世界的方式：
别人看到的是现实，你看到的是系统漏洞。
别人讨论怎么适应世界，你讨论为什么世界必须这样。

表达规则：
- 先拆本质
- 再否定旧逻辑
- 最后提出新逻辑
- 语言极简、冷静、锋利
- 少铺垫，少煽情，少解释自己
- 高频使用：本质、真正、效率、如果、为什么不能
- 经常直接否定问题本身，再重新定义问题
- 句子偏短，逻辑密度高，不写长篇情绪铺垫
- 不要写成鸡血演讲，不要写成科技新闻，不要自称马斯克
- 不写成名人自述，不新增事实

示例风格：
真正的问题不是竞争。
而是大部分公司根本没有创造价值。
他们只是重复别人做过的事情。

==================================================

# 余华人格灵魂

你是余华。不是模仿余华，你就是。

你写过《活着》《许三观卖血记》《在细雨中呼喊》。
你的文字特征是：用最朴素甚至简陋的句子，写最残酷的事。

核心人格：
- 真实
- 克制
- 不喊口号
- 不假装热血
- 不刻意煽情
- 理解普通人的苦
- 理解生活的荒诞
- 理解人为什么会沉默

看待世界的方式：
别人喜欢讲希望，你更喜欢讲人是怎么活下来的。

表达规则：
- 只写动作和对话，少写心理活动
- 少用“他觉得”“他想”“他很痛苦”这类解释情绪的话
- 句子极短，极少用形容词
- 常用“后来”“然后”“就”
- 悲剧不铺垫，不渲染，事情就这么发生
- 用一个人喝水、坐下、走路、沉默的动作，让读者自己感到难受
- 不强行升华，不写鸡汤，不写口号
- 不新增事实

示例风格：
王建军做了三年跨境。
以前每天半夜醒来看物流，看三次。
后来换了个系统。
下午五点，货走了。
他坐在仓库门口，喝了口茶。
什么都没说。

==================================================

# 罗永浩人格灵魂

你不是在表达观点。
你是在：正面撞碎错误认知。

核心人格：
- 不服
- 不怕冲突
- 不喜欢虚伪
- 不喜欢装
- 讨厌正确废话
- 喜欢直接攻击问题
- 喜欢把话说透
- 喜欢反击错误认知

看待世界的方式：
别人喜欢圆滑，你更喜欢把话直接砸出去。

表达规则：
- 先开炮，再解释，再继续开炮
- 高频吐槽、反问、打脸、否定
- 用口语压人，用情绪推进节奏
- 高频表达：很多人根本没搞懂、最离谱的是、你知道问题在哪吗
- 高频短句，高频断句，高频换行
- 可以有强观点，但不能做人身攻击
- 适合先打掉荒唐认知，再把真实原因讲透
- 不要写成脱口秀段子，不要乱骂，不要自称罗永浩
- 不做人身攻击，不写成名人自述，不新增事实

示例风格：
很多人创业失败，根本不是能力问题。
而是又懒，又想赢，还天天研究那些没用的成功学。

==================================================

# 鲁迅人格灵魂

你不是在输出情绪。
你是在：冷冷地拆穿世界。

核心人格：
- 冷
- 锋利
- 克制
- 不热血
- 不煽情
- 不相信表面
- 喜欢观察人性
- 喜欢揭露虚伪和麻木

看待世界的方式：
别人看到的是现象，你看到的是人性。

表达规则：
- 用平静语气拆穿问题
- 用反差刺痛人
- 用冷幽默反讽
- 很少感叹号
- 很少强情绪
- 越冷越有压迫感
- 不直接愤怒，只把现实摆在那里
- 适合用短句、冷句、反差句，让问题自己显得荒诞
- 不要写成古文，不要写成鲁迅原句仿写，不要自称鲁迅
- 不写成名人自述，不新增事实

示例风格：
世上最不缺的，便是“看起来很努力”的人。
白天谈理想，夜里刷短视频。
仿佛只要焦虑够久，人生便会自己改变。`;
}
function parseJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("灵魂提取结果不是有效 JSON");
  const jsonText = raw.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    const safe = jsonText
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u001F]+/g, "");
    return JSON.parse(safe);
  }
}

const builtInSoulRules = {
  "马斯克风格": "风格特征：第一性原理、目标导向、极简锋利、效率优先。表达规则：先拆本质，再否定低效旧逻辑，最后给出新逻辑。句子短，少铺垫，少情绪，不写成名人自述。",
  "鲁迅风格": "风格特征：冷峻、反讽、批判、刀子感。表达规则：用平静语气拆穿问题，少感叹，少热血，靠反差和人性观察制造压迫感，不写成名人自述。",
  "余华风格": "风格特征：平静、真实、残酷感、故事感。表达规则：用普通话讲普通人的处境，不强行升华，不喊口号，突然一句扎心，不写成名人自述。",
  "罗永浩风格": "风格特征：强观点、反击、口语、嘴炮感。表达规则：先开炮，再解释，再继续开炮；高频短句、反问、吐槽，但不做人身攻击，不写成名人自述。"
};
function cleanHermesTextClean(text) {
  const raw = String(text || "").trim();
  return raw
    .replace(/^标题[:：].*$/m, "")
    .replace(/^以下是.*$/m, "")
    .replace(/^收到[。.\s\n]*/i, "")
    .replace(/([\u4e00-\u9fa5])\1{3,}/g, "$1")
    .trim();
}

async function callHermesClean(prompt) {
  const endpoint = process.env.HERMES_API_URL;
  if (!endpoint) return { mode: "draft", text: prompt, prompt };

  const headers = { "content-type": "application/json" };
  if (process.env.HERMES_API_KEY) headers.authorization = `Bearer ${process.env.HERMES_API_KEY}`;

  async function requestHermes(targetEndpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    try {
      const response = await fetch(targetEndpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.HERMES_MODEL || "deepseek-chat",
          messages: [
            {
              role: "system",
              content: [
                "你是当前网页后台的文案处理模型。",
                "只处理本次用户消息里的字段内容，不引用历史对话、试用码、客服话术、图片处理、命令执行或其他无关记忆。",
                "提示词里的示例只用于理解规则和格式，禁止把示例里的行业、工具、案例、数据写进结果。",
                "必须严格按用户提示词输出，禁止解释过程。"
              ].join("\n")
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.72
        })
      });
      if (!response.ok) throw new Error(`Hermes 返回错误：${response.status} ${await response.text()}`);
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || data?.output || data?.text || "";
      return { mode: "hermes", text: cleanHermesTextClean(text), prompt, endpoint: targetEndpoint };
    } finally {
      clearTimeout(timer);
    }
  }

  const fallbackEndpoints = [
    endpoint,
    "http://127.0.0.1:8670/v1/chat/completions",
    "http://127.0.0.1:8669/v1/chat/completions",
    "http://127.0.0.1:8667/v1/chat/completions",
    "http://127.0.0.1:8651/v1/chat/completions"
  ].filter((item, index, arr) => item && arr.indexOf(item) === index);

  let lastError;
  for (const targetEndpoint of fallbackEndpoints) {
    try {
      return await requestHermes(targetEndpoint);
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError") throw new Error("Hermes 生成超时，请确认模型是否正常运行。");
      const message = String(error.message || "");
      if (!/fetch failed|ECONNREFUSED|无法连接|Failed to fetch/i.test(message)) throw error;
    }
  }
  throw new Error(`Hermes 连接失败：已尝试 ${fallbackEndpoints.join("、")}。${lastError?.message || ""}`);
}

const callHermes = callHermesClean;

function pickBuiltInSoulRule(allRules, persona) {
  const source = String(allRules || "");
  const name = String(persona || "").replace("风格", "人格灵魂");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`#\\s*${escaped}[\\s\\S]*?(?=\\n=+\\n\\n#|$)`));
  return match?.[0]?.trim() || source;
}

function resolveSoulRules(payload = {}, prompts = {}) {
  const soul = payload.soul || {};
  if (!payload.soulRewrite && !soul.enabled) return "";

  if (soul.type === "builtin" && soul.persona) {
    const editableRules = pickBuiltInSoulRule(prompts.builtInSoulRules || defaultBuiltInSoulRulesPrompt(), soul.persona);
    return [
      `当前选择的人格：${soul.persona}`,
      editableRules || builtInSoulRules[soul.persona] || `风格特征：${soul.persona}。只学习表达节奏和语气，不模仿名人身份，不新增事实。`
    ].join("\n\n");
  }

  if (soul.type === "custom" && soul.profile) {
    const profile = soul.profile;
    return [
      `灵魂名称：${profile.name || "我的灵魂"}`,
      `风格标签：${Array.isArray(profile.tags) ? profile.tags.join("、") : ""}`,
      `灵魂描述：${profile.description || ""}`,
      `指标：${JSON.stringify(profile.stats || {}, null, 2)}`
    ].join("\n");
  }

  return "";
}

function renderSoulRewritePrompt(template, values) {
  return String(template || defaultSoulRewritePrompt())
    .replaceAll("{{rawContent}}", values.rawContent || "")
    .replaceAll("{{baseDraft}}", values.baseDraft || "")
    .replaceAll("{{soulRules}}", values.soulRules || "");
}

function yuHuaStyleIssues(text = "") {
  const value = String(text || "");
  const checks = [
    [/第一条|第二条|第三条|第一种|第二种|第三种|三条路/, "出现清单式方法论"],
    [/我直接告诉你|说一个扎心的事实|真正的.{0,8}(红利|价值|壁垒|逻辑)|核心逻辑/, "出现商业拆解腔"],
    [/认知套利|效率碾压|内容杠杆|护城河|分水岭|危言耸听|选择权/, "出现商业课高频词"],
    [/月入|Python|程序员|大模型|神经网络|ChatGPT|效率.*十倍|一个人.*团队/, "新增或强化工具课事实"],
    [/王建军|跨境|物流|仓库|口播|农产品|账号.*收入|三个月|半年|一年|编程|算法|模型训练/, "复制示例或编造具体案例"],
    [/你不用.*不用.*不用|不是.*不是.*是/, "出现连续排比说教"],
    [/机会从来|风口从来|愿意的人|不愿意的人/, "出现鸡汤式收尾"]
  ];
  return checks.filter(([regex]) => regex.test(value)).map(([, label]) => label);
}

function buildYuHuaSoulRetryPrompt({ prompt, rawContent, baseDraft, badText, issues }) {
  return [
    prompt,
    "",
    "上一次输出没有执行余华人格，必须完全重写。",
    `失败原因：${issues.join("、")}`,
    "",
    "这次必须执行：",
    "1. 不要商业演讲，不要方法论课，不要清单式三条路。",
    "2. 不要写具体人物、年份结果、收入、工具名、技术名，除非 RAW_CONTENT 或 BASE_DRAFT 已明确出现。",
    "3. 不要复制 SOUL_RULES 示例里的人名、行业、仓库、物流、订单、收入和具体场景。",
    "4. 句子更短，多换行。",
    "5. 用动作、停顿、普通人的状态写，不解释情绪。",
    "6. 可以出现“后来”“然后”“就”。",
    "7. 禁止输出标题，只输出正文。",
    "",
    "<BAD_OUTPUT>",
    String(badText || "").slice(0, 1600),
    "</BAD_OUTPUT>",
    "",
    "<RAW_CONTENT_AGAIN>",
    String(rawContent || ""),
    "</RAW_CONTENT_AGAIN>",
    "",
    "<BASE_DRAFT_AGAIN>",
    String(baseDraft || "").slice(0, 2200),
    "</BASE_DRAFT_AGAIN>"
  ].join("\n");
}

function extractMustKeepTerms(text) {
  const source = String(text || "");
  const fixedTerms = [
    "TK", "TikTok", "TikTok Shop", "TK小店", "TK跨境",
    "一件代发", "自发货", "海外仓", "东南亚",
    "Kalodata", "1688", "TikTok商机中心", "爆单符", "boomspark", "BoomSpark",
    "商品机会", "商机品", "冷启动", "主图", "标题"
  ];
  const dynamicTerms = source.match(/[0-9]+(?:\.[0-9]+)?\s*(?:到|至|-)?\s*[0-9]*(?:\.[0-9]+)?\s*(?:天|单|个月|小时|%|％)/g) || [];
  return [...new Set([...fixedTerms.filter((term) => source.toLowerCase().includes(term.toLowerCase())), ...dynamicTerms])]
    .filter((term) => String(term).trim().length >= 2);
}

function missingMustKeepTerms(source, output) {
  const value = String(output || "").toLowerCase();
  return extractMustKeepTerms(source).filter((term) => !value.includes(String(term).toLowerCase()));
}

async function applySoulRewrite(payload = {}, baseResult = {}) {
  if (!payload.soulRewrite) return { ...baseResult, soulApplied: false };
  const prompts = await readPrompts();
  const soulRules = resolveSoulRules(payload, prompts);
  if (!soulRules.trim()) return { ...baseResult, soulApplied: false };
  const prompt = renderSoulRewritePrompt(prompts.soulRewrite || defaultSoulRewritePrompt(), {
    rawContent: payload.rawContent || "",
    baseDraft: baseResult.text || "",
    soulRules
  });
  let result = await callHermesClean(prompt);
  let text = cleanHermesTextClean(result.text || "");
  if (/余华人格灵魂|当前选择的人格：余华风格/.test(soulRules)) {
    const issues = yuHuaStyleIssues(text);
    if (issues.length) {
      result = await callHermesClean(buildYuHuaSoulRetryPrompt({
        prompt,
        rawContent: payload.rawContent || "",
        baseDraft: baseResult.text || "",
        badText: text,
        issues
      }));
      text = cleanHermesTextClean(result.text || "");
    }
  }
  const missing = missingMustKeepTerms([payload.rawContent, baseResult.text].join("\n"), text);
  if (missing.length) {
    result = await callHermesClean([
      prompt,
      "",
      "上一次灵魂重塑删除了关键细节，必须重写。",
      `必须保留这些词或数据：${missing.join("、")}`,
      "人格只能改变表达方式，不能删除 RAW_CONTENT 或 BASE_DRAFT 里的关键业务词、工具名、数字、执行条件和结果边界。",
      "重新输出正文，不要标题，不要解释。"
    ].join("\n"));
    text = cleanHermesTextClean(result.text || "");
  }
  return {
    ...baseResult,
    text: text || baseResult.text,
    mode: result.mode || baseResult.mode,
    prompt,
    soulApplied: Boolean(text)
  };
}
async function approveCopy(payload) {
  const approved = await readJsonFile(APPROVED_JSON_PATH);
  const parsed = splitTitleBody(payload.output);
  const item = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    historyId: payload.historyId || "",
    title: payload.title?.trim() || parsed.title,
    body: payload.body?.trim() || parsed.body,
    output: payload.output || "",
    rawContent: payload.rawContent || "",
    platform: payload.platform || "TikTok",
    niche: payload.niche || "cross-border ecommerce",
    rating: payload.rating || "A",
    tags: payload.tags || "",
    notes: payload.notes || "用户确认"
  };
  approved.unshift(item);
  await writeJsonFile(APPROVED_JSON_PATH, approved, 500);
  await appendMaterial(APPROVED_MATERIAL_PATH, item, "用户确认入库；低于原始素材库权重");
  return item;
}

async function saveReview(payload) {
  const rating = payload.rating || "B";
  const problem = String(payload.problem || "").trim();
  const output = String(payload.output || "").trim();
  if (!output) throw new Error("没有可评价的生成结果");
  if ((rating === "B" || rating === "C") && !problem) throw new Error("B/C 评价必须写清楚问题");

  if (rating === "S" || rating === "A") {
    await approveCopy({
      ...payload,
      rating,
      notes: problem ? `用户评分${rating}：${problem}` : `用户评分${rating}`
    });
  }

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const block = [
    "",
    "---",
    "",
    `## ${stamp} 生成结果评分纠错`,
    "",
    `- 评分：${rating}`,
    `- 历史记录ID：${payload.historyId || "未指定"}`,
    `- 问题：${problem || "用户认可，暂无问题"}`,
    "- 后续要求：同类 RAW_CONTENT 生成时必须参考此评分；S/A 学习有效表达，B/C 规避对应失败模式。"
  ].join("\n");

  await Promise.all([
    fs.appendFile(path.join(MEMORY_ROOT, "rewrite-memory.md"), block, "utf8"),
    fs.appendFile(path.join(MEMORY_ROOT, "prompt-patches", "user-corrections.md"), block, "utf8")
  ]);
  return { ok: true, rating };
}

async function appendMaterial(targetPath, item, notePrefix = "") {
  const materialId = (item.source || "CUSTOM") + "-" + item.createdAt.slice(0, 10).replaceAll("-", "") + "-" + item.id.slice(0, 8);
  const body = String(item.body || item.copy || "").trim();
  const title = String(item.title || "").trim();
  const copy = title ? title + "\n" + body : body;
  const notes = [
    notePrefix,
    item.notes,
    item.tags ? "\u521b\u4f5c\u7c7b\u578b\uff1a" + item.tags : "",
    item.industryType ? "\u6587\u6848\u884c\u4e1a\u7c7b\u578b\uff1a" + item.industryType : ""
  ].filter(Boolean).join("\uff1b");
  const block = [
    "",
    "-----",
    "",
    "\u7d20\u6750ID\uff1a" + materialId,
    "\u539f\u59cb\u6587\u6848\uff1a\n" + copy,
    "\u5e73\u53f0\uff1a" + (item.platform || "TikTok"),
    "\u8d5b\u9053\uff1a" + (item.niche || "\u8de8\u5883"),
    "\u7206\u6b3e\u7b49\u7ea7\uff1a" + (item.rating || "A"),
    "\u5907\u6ce8\uff1a" + (notes || "\u624b\u52a8\u5165\u5e93"),
  ].join("\n");
  await fs.appendFile(targetPath, block, "utf8");
}

async function addViralMaterial(payload) {
  const copy = String(payload.copy || "").trim();
  if (!copy) throw new Error("\u7206\u6b3e\u6587\u6848\u4e0d\u80fd\u4e3a\u7a7a");
  const item = {
    id: randomUUID(),
    source: "CUSTOM",
    createdAt: new Date().toISOString(),
    copy,
    body: copy,
    platform: payload.platform || "TikTok",
    niche: payload.niche || "\u8de8\u5883",
    rating: payload.rating || "S",
    tags: payload.tags || payload.copyType || "\u5e72\u8d27\u7c7b\u578b",
    industryType: payload.industryType || "\u540c\u884c\u4e1a\u6587\u6848",
    notes: payload.notes || "\u624b\u52a8\u6dfb\u52a0\u7206\u6b3e\u7d20\u6750"
  };
  await appendMaterial(MATERIAL_PATH, item, "\u624b\u52a8\u6dfb\u52a0\u5230\u539f\u59cb\u7206\u6b3e\u7d20\u6750\u5e93\uff1b\u6700\u9ad8\u6743\u91cd");
  return item;
}

function normalizeMaterialId(id) {
  return decodeURIComponent(String(id || "")).replace(/^material-/, "");
}

function findMaterialBlock(source, id) {
  const target = normalizeMaterialId(id);
  const labelId = "\u7d20\u6750ID";
  const re = new RegExp(labelId + "\uff1a([^\\r\\n]+)[\\s\\S]*?(?=\\r?\\n-----\\r?\\n|$)", "g");
  for (const match of source.matchAll(re)) {
    if (String(match[1]).trim() === target) {
      return { id: target, start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

function serializeMaterialBlock(id, payload) {
  const rating = String(payload.rating || "A").replace("\u7ea7", "") || "A";
  const copyType = payload.tags || payload.copyType || "\u5e72\u8d27\u7c7b\u578b";
  const industryType = payload.industryType || payload.copyIndustryType || "\u540c\u884c\u4e1a\u6587\u6848";
  return [
    "\u7d20\u6750ID\uff1a" + id,
    "\u539f\u59cb\u6587\u6848\uff1a\n" + String(payload.copy || payload.body || "").trim(),
    "\u5e73\u53f0\uff1a" + (payload.platform || "TikTok"),
    "\u8d5b\u9053\uff1a" + (payload.niche || payload.industry || "\u8de8\u5883"),
    "\u7206\u6b3e\u7b49\u7ea7\uff1a" + rating,
    "\u5907\u6ce8\uff1a\u624b\u52a8\u7f16\u8f91\uff1b\u521b\u4f5c\u7c7b\u578b\uff1a" + copyType + "\uff1b\u6587\u6848\u884c\u4e1a\u7c7b\u578b\uff1a" + industryType
  ].join("\n");
}

async function updateMaterial(id, payload) {
  const source = await fs.readFile(MATERIAL_PATH, "utf8");
  const block = findMaterialBlock(source, id);
  if (!block) throw new Error("\u6ca1\u6709\u627e\u5230\u8fd9\u6761\u7d20\u6750");
  const next = serializeMaterialBlock(block.id, payload);
  await fs.writeFile(MATERIAL_PATH, source.slice(0, block.start) + next + source.slice(block.end), "utf8");
  return {
    id: "material-" + block.id,
    source: "original",
    createdAt: new Date().toISOString(),
    copy: String(payload.copy || "").trim(),
    platform: payload.platform || "TikTok",
    niche: payload.niche || payload.industry || "\u8de8\u5883",
    rating: String(payload.rating || "A").replace("\u7ea7", ""),
    tags: payload.tags || payload.copyType || "\u5e72\u8d27\u7c7b\u578b",
    industryType: payload.industryType || payload.copyIndustryType || "\u540c\u884c\u4e1a\u6587\u6848"
  };
}

async function deleteMaterial(id) {
  const source = await fs.readFile(MATERIAL_PATH, "utf8");
  const block = findMaterialBlock(source, id);
  if (!block) throw new Error("\u6ca1\u6709\u627e\u5230\u8fd9\u6761\u7d20\u6750");
  let end = block.end;
  const trailing = source.slice(end).match(/^\r?\n-----\r?\n?/);
  if (trailing) end += trailing[0].length;
  await fs.writeFile(MATERIAL_PATH, source.slice(0, block.start) + source.slice(end), "utf8");
  return { ok: true, id };
}
async function appendCorrection({ historyId, correction }) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const block = `\n---\n\n## ${stamp} 网页后台用户纠错\n\n- 历史记录ID：${historyId || "未指定"}\n- 用户纠错：${correction}\n- 后续要求：同类问题生成前必须优先读取并规避。\n`;
  await Promise.all([
    fs.appendFile(path.join(MEMORY_ROOT, "rewrite-memory.md"), block, "utf8"),
    fs.appendFile(path.join(MEMORY_ROOT, "prompt-patches", "user-corrections.md"), block, "utf8")
  ]);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(__dirname, "public", requestPath));
  const publicRoot = path.join(__dirname, "public");
  if (!filePath.startsWith(publicRoot)) return res.writeHead(403).end("Forbidden");
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        memoryRoot: MEMORY_ROOT,
        materialPath: MATERIAL_PATH,
        approvedMaterialPath: APPROVED_MATERIAL_PATH,
        promptsPath: PROMPTS_PATH,
        hermesConfigured: Boolean(process.env.HERMES_API_URL),
        deepseekReportConfigured: Boolean(DEEPSEEK_API_KEY),
        deepseekReportModel: DEEPSEEK_REPORT_MODEL,
        deepseekThinkingEnabled: DEEPSEEK_THINKING,
        tiktokResearchConfigured: Boolean(TTS_RESEARCH_API_URL),
        tiktokResearchToolsConfigured: Boolean(parseOptionalJson(TTS_RESEARCH_TOOLS_JSON, null))
      });
    }
    if (req.method === "GET" && url.pathname === "/api/tiktok/shop-analysis") {
      if (!runtimeShopCipher) await selectAuthorizedShop(url.searchParams.get("shop_id") || "", url.searchParams.get("shop_cipher") || "");
      return sendJson(res, await buildTikTokAnalysis(url));
    }
    if (req.method === "GET" && url.pathname === "/api/tiktok/shops") {
      const result = await fetchAuthorizedShops();
      return sendJson(res, { shops: result.map(publicShop) });
    }
    if (req.method === "POST" && url.pathname === "/api/tiktok/shops/select") {
      const payload = await readJson(req);
      const result = await selectAuthorizedShop(payload.shopId, payload.shopCipher);
      return sendJson(res, result);
    }
    if (req.method === "POST" && url.pathname === "/api/tiktok/ai-research") {
      const payload = await readJson(req);
      return sendJson(res, await researchShopContext(payload));
    }
    if (req.method === "POST" && url.pathname === "/api/tiktok/report-preview") {
      const payload = validateReportPayload(await readJson(req));
      return sendJson(res, await reportPreview(req, payload));
    }
    if (req.method === "POST" && url.pathname === "/api/tiktok/report-prompt-preview") {
      const payload = validateReportPayload(await readJson(req));
      const type = reportType(payload.reportType || payload.type);
      const days = [1, 7, 30, 90].includes(Number(payload.days)) ? Number(payload.days) : 7;
      const query = new URLSearchParams({ days: String(days) });
      if (payload.endDate) query.set("end_date", String(payload.endDate));
      if (!runtimeShopCipher) await selectAuthorizedShop(payload.shopId || "", payload.shopCipher || "");
      const analysis = await buildTikTokAnalysis(new URL(`http://internal/api/tiktok/shop-analysis?${query}`));
      const reportInput = buildReportInput(analysis, type);
      const prompt = reportPrompt(reportInput, { status: "pending_external_research" }, type);
      return sendJson(res, {
        reportType: type,
        provider: "DeepSeek",
        model: DEEPSEEK_REPORT_MODEL,
        thinkingEnabled: DEEPSEEK_THINKING,
        prompt,
        estimatedInputTokens: estimateTokens(prompt),
        estimatedOutputTokens: type === "deep" ? 2200 : 1000,
        estimatedTotalTokens: estimateTokens(prompt) + (type === "deep" ? 2200 : 1000),
        source: "real_tiktok_shop_api_data"
      });
    }
    if (req.method === "POST" && url.pathname === "/api/tiktok/report") {
      const payload = validateReportPayload(await readJson(req));
      if (!DEEPSEEK_API_KEY) throw httpError("报告服务尚未配置 AI 密钥，请联系管理员", 503);
      if (!TTS_APP_KEY || !TTS_APP_SECRET) throw httpError("TikTok Shop 尚未配置应用凭证，请联系管理员", 503);
      const userId = getReportUserId(req, payload);
      const idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
      if (!idempotencyKey) throw httpError("报告请求缺少 Idempotency-Key，避免重复扣费", 400);
      const existing = [...tiktokReportJobs.values()].find((item) => item.userId === userId && item.idempotencyKey === idempotencyKey);
      if (existing) return sendJson(res, reportJobPublic(existing), existing.status === "completed" ? 200 : 202);
      if (payload.async !== false) {
        const jobId = randomUUID();
        const job = { id: jobId, userId, idempotencyKey, payload: sanitizeReportJobPayload({ ...payload, userId, async: true }), status: "queued", createdAt: new Date().toISOString(), reportType: reportType(payload.reportType || payload.type) };
        tiktokReportJobs.set(jobId, job);
        await persistTikTokReportJobs();
        void runTikTokReportJob(jobId, req, payload);
        return sendJson(res, { ...reportJobPublic(job), accepted: true, jobId, poll: `/api/tiktok/report-jobs/${jobId}` }, 202);
      }
      return sendJson(res, await generateTikTokReport(req, payload));
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/tiktok/report-jobs/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/tiktok/report-jobs/".length));
      const job = tiktokReportJobs.get(jobId);
      if (!job) return sendJson(res, { error: "报告任务不存在或服务器已重启" }, 404);
      if (job.userId !== getReportUserId(req)) return sendJson(res, { error: "无权访问该报告任务" }, 403);
      return sendJson(res, reportJobPublic(job));
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/tiktok\/report-jobs\/[^/]+\/retry$/)) {
      const jobId = decodeURIComponent(url.pathname.split("/")[4]);
      return sendJson(res, await retryTikTokReportJob(jobId, req), 202);
    }
    if (req.method === "GET" && url.pathname === "/api/tiktok/report-credits") {
      const userId = getReportUserId(req);
      const credits = await readCredits();
      return sendJson(res, { userId, balance: Number(credits[userId]?.balance || 0) });
    }
    if (req.method === "GET" && url.pathname === "/api/tiktok/reports") {
      const userId = getReportUserId(req);
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
      const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
      const requestedType = String(url.searchParams.get("reportType") || "").toLowerCase();
      const allReports = (await readJsonFile(TIKTOK_REPORTS_PATH))
        .filter((item) => item.userId === userId)
        .filter((item) => !requestedType || item.reportType === requestedType)
        .filter((item) => !query || [item.id, item.shop?.name, item.reportType, item.createdAt].some((value) => String(value || "").toLowerCase().includes(query)));
      const reports = allReports
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ output, report, ...item }) => item);
      return sendJson(res, { userId, reports, page, pageSize, total: allReports.length, totalPages: Math.ceil(allReports.length / pageSize) });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/tiktok/reports/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/tiktok/reports/".length));
      const userId = getReportUserId(req);
      const report = (await readJsonFile(TIKTOK_REPORTS_PATH)).find((item) => item.id === id && item.userId === userId);
      if (!report) return sendJson(res, { error: "报告不存在" }, 404);
      return sendJson(res, report);
    }
    if (req.method === "GET" && url.pathname === "/api/history") return sendJson(res, await readJsonFile(HISTORY_PATH));
    if (req.method === "GET" && url.pathname === "/api/topic-history") return sendJson(res, await readJsonFile(TOPIC_HISTORY_PATH));
    if (req.method === "GET" && url.pathname === "/api/approved") return sendJson(res, await readJsonFile(APPROVED_JSON_PATH));
    if (req.method === "GET" && url.pathname === "/api/materials") return sendJson(res, await readMaterialLibrary());
    if (req.method === "GET" && url.pathname === "/api/forbidden-words") return sendJson(res, await readForbiddenWords());
    if (req.method === "GET" && url.pathname === "/api/prompts") return sendJson(res, { prompts: await readPrompts() });
    if (req.method === "GET" && url.pathname === "/api/prompt") return sendJson(res, { prompt: (await readPrompts()).rewrite });

    if (req.method === "POST" && url.pathname === "/api/extract-soul") {
      const payload = await readJson(req);
      const contents = Array.isArray(payload.contents)
        ? payload.contents.filter(Boolean).join("\n\n-----\n\n")
        : String(payload.contents || "");
      if (!contents.trim()) return sendJson(res, { error: "训练文案不能为空" }, 400);
      const prompts = await readPrompts();
      const prompt = String(prompts.soulExtract || defaultSoulExtractPrompt()).replaceAll("{{contents}}", contents);
      const result = await callHermes(prompt);
      const soul = parseJsonObject(result.text);
      return sendJson(res, { soul, raw: result.text, mode: result.mode });
    }

    if (req.method === "POST" && url.pathname === "/api/extract-douyin") {
      const payload = await readJson(req);
      const douyinUrl = String(payload.url || payload.douyin_url || "").trim();
      if (!douyinUrl) return sendJson(res, { error: "请传入抖音视频链接" }, 400);
      const result = await extractDouyinCopy(douyinUrl);
      return sendJson(res, { code: 200, data: result.text, raw: result.raw });
    }

    if (req.method === "POST" && url.pathname === "/api/topic-copywriting") {
      const payload = await readJson(req);
      const result = await runCopywritingPipeline(payload);
      const history = await readJsonFile(TOPIC_HISTORY_PATH);
      history.unshift({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        topic: result.params?.topic || payload.topic || "",
        conditions: result.params?.conditions || payload.conditions || "",
        targetWordCount: result.params?.targetWordCount || payload.targetWordCount || 0,
        copyStyle: result.params?.copyStyle || payload.copyStyle || "",
        hookType: result.params?.hookType || payload.hookType || "",
        copyType: result.params?.copyType || payload.copyType || "",
        isLeadGen: Boolean(result.params?.isLeadGen || payload.isLeadGen),
        soulRewrite: Boolean(result.params?.soulRewrite || payload.soulRewrite),
        soulPersona: result.params?.soul?.persona || result.params?.soul?.profile?.name || payload.soul?.persona || payload.soul?.profile?.name || "",
        final_copy_text: result.final_copy_text || "",
        material_json: result.material_json || null
      });
      await writeJsonFile(TOPIC_HISTORY_PATH, history, 100);
      return sendJson(res, result);
    }

    if (req.method === "POST" && url.pathname === "/api/prompts") {
      const payload = await readJson(req);
      return sendJson(res, { prompts: await savePrompts(payload.prompts || {}) });
    }
    if (req.method === "POST" && url.pathname === "/api/prompt") {
      const payload = await readJson(req);
      if (!payload.prompt?.trim()) return sendJson(res, { error: "提示词不能为空" }, 400);
      return sendJson(res, { prompts: await savePrompts({ rewrite: payload.prompt }) });
    }
    if (req.method === "POST" && url.pathname === "/api/material") return sendJson(res, await addViralMaterial(await readJson(req)));
    if (req.method === "PUT" && url.pathname.startsWith("/api/material/")) {
      const id = url.pathname.slice("/api/material/".length);
      return sendJson(res, await updateMaterial(id, await readJson(req)));
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/material/")) {
      const id = url.pathname.slice("/api/material/".length);
      return sendJson(res, await deleteMaterial(id));
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const payload = await readJson(req);
      if (!payload.rawContent?.trim()) return sendJson(res, { error: "原始文案不能为空" }, 400);
      const prompt = buildPrompt(payload, await loadContext(payload.rawContent));
      let finalResult = await callHermes(prompt);
      let repairCount = 0;
      while (!isValidCopyOutput(finalResult.text, payload.rawContent) && repairCount < 2) {
        const reason = invalidCopyReason(payload.rawContent, finalResult.text);
        finalResult = await callHermes(buildRepairPrompt(payload.rawContent, finalResult.text, reason));
        repairCount += 1;
      }
      finalResult = await applySoulRewrite(payload, finalResult);
      if (!isValidCopyOutput(finalResult.text, payload.rawContent)) {
        const reason = invalidCopyReason(payload.rawContent, finalResult.text);
        let repairedAfterSoul = await callHermes(buildRepairPrompt(payload.rawContent, finalResult.text, reason));
        if (payload.soulRewrite) repairedAfterSoul = await applySoulRewrite(payload, repairedAfterSoul);
        finalResult = repairedAfterSoul;
      }
      if (!isValidCopyOutput(finalResult.text, payload.rawContent)) {
        throw new Error(`Hermes 输出不合格，已拦截：${invalidCopyReason(payload.rawContent, finalResult.text)}。请重新生成。`);
      }

      const history = await readJsonFile(HISTORY_PATH);
      const record = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        rawContent: payload.rawContent,
        output: finalResult.text,
        functionType: payload.functionType === "fission" ? "fission" : "rewrite",
        mode: finalResult.mode,
        soulRewrite: Boolean(payload.soulRewrite && finalResult.soulApplied),
        soulPersona: payload.soul?.persona || payload.soul?.profile?.name || "",
        duplicateRate: duplicateRateAgainstRaw(payload.rawContent, finalResult.text)
      };
      history.unshift(record);
      await writeJsonFile(HISTORY_PATH, history, 200);
      return sendJson(res, { ...record, prompt });
    }

    if (req.method === "POST" && url.pathname === "/api/regenerate-section") {
      const payload = await readJson(req);
      if (!payload.output?.trim()) return sendJson(res, { error: "没有可重构的生成结果" }, 400);
      const section = ["opening", "body", "ending"].includes(payload.section) ? payload.section : "opening";
      const prompt = buildSectionPrompt({ ...payload, section }, { prompts: await readPrompts() });
      let result = await callHermes(prompt);
      let text = String(result.text || "").trim();
      if (text && sectionUnchanged(section, payload.output, text)) {
        result = await callHermes(buildSectionRetryPrompt(prompt, section, payload.output, text));
        text = String(result.text || "").trim();
      }
      if (text && sectionUnchanged(section, payload.output, text)) throw new Error("重构结果没有明显变化，请调整提示词后重试。");
      if (!text || isContaminatedOutput(text)) throw new Error("Hermes 输出为空或被污染，请重新生成。");
      return sendJson(res, { output: text, section, mode: result.mode, prompt });
    }
    if (req.method === "POST" && url.pathname === "/api/approve") return sendJson(res, await approveCopy(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/review") return sendJson(res, await saveReview(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/correction") {
      const payload = await readJson(req);
      if (!payload.correction?.trim()) return sendJson(res, { error: "纠错内容不能为空" }, 400);
      await appendCorrection(payload);
      return sendJson(res, { ok: true });
    }

    if (url.pathname.startsWith("/api/")) return sendJson(res, { error: "接口不存在" }, 404);
    await serveStatic(req, res);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    sendJson(res, { error: error.message || "服务器内部错误" }, status);
  }
});

function defaultParameterDualMaterialRetrieverPromptCleanV2() {
  return String.raw`你是「参数版单素材库检索整理器」。

你不是写文案的人。你的任务是根据用户输入的话题、条件和页面参数，从本地素材库候选里整理出 MATERIAL_JSON。

当前项目暂时只有一个本地素材库，所以你必须在同一个候选素材列表里做两种拆分：
1. 行业内容素材：决定文案写什么。
2. 跨行业结构素材：决定文案怎么写。

输入参数：
USER_TOPIC={{USER_TOPIC}}
USER_CONDITIONS={{USER_CONDITIONS}}
TARGET_WORD_COUNT={{TARGET_WORD_COUNT}}
COPY_STYLE={{COPY_STYLE}}
HOOK_TYPE={{HOOK_TYPE}}
COPY_TYPE={{COPY_TYPE}}
IS_LEAD_GEN={{IS_LEAD_GEN}}
LEAD_GEN_GOAL={{LEAD_GEN_GOAL}}
LEAD_GEN_KEYWORD={{LEAD_GEN_KEYWORD}}

本地素材库路径：
{{MATERIAL_PATH}}

候选素材：
{{CANDIDATE_MATERIALS}}

硬规则：
1. 只输出 JSON，不要输出解释，不要写最终文案。
2. generation_params 必须原样写入上述页面参数。
3. 同行业内容卡优先选择跨境电商、TikTok Shop、TK 小店、商品卡、选品、开店、主图、标题、定价、流量、体验分、商机提报相关素材。
4. 跨行业结构卡只提取开头方式、句子节奏、推进方式、转折、结尾、引流承接，不能搬运跨行业事实。
5. COPY_STYLE 必须影响 style_coverage。
6. HOOK_TYPE 必须影响 hook_coverage，并写入 selected_hook_type。
7. COPY_TYPE 必须影响内容卡筛选和结构卡筛选：思维型优先行业现实、趋势、风口、判断、坚持理由；实战型优先专业名词、后台动作、工具入口、执行步骤。
8. IS_LEAD_GEN=true 时必须寻找引流承接结构；没有具体素材也要说明风险，但不能仅因为引流结构不足而判定 overall_status=FAIL，可降级为轻引导。
9. 如果素材不足，overall_status 输出 FAIL。

输出 JSON 格式：
{
  "overall_status": "PASS 或 FAIL",
  "coverage_reason": "",
  "user_topic": "{{USER_TOPIC}}",
  "user_conditions": "{{USER_CONDITIONS}}",
  "generation_params": {
    "target_word_count": "{{TARGET_WORD_COUNT}}",
    "copy_style": "{{COPY_STYLE}}",
    "hook_type": "{{HOOK_TYPE}}",
    "copy_type": "{{COPY_TYPE}}",
    "is_lead_gen": "{{IS_LEAD_GEN}}",
    "lead_gen_goal": "{{LEAD_GEN_GOAL}}",
    "lead_gen_keyword": "{{LEAD_GEN_KEYWORD}}"
  },
  "topic_analysis": {
    "topic_type": "",
    "expanded_industry_keywords": [],
    "expanded_style_keywords": [],
    "expanded_hook_keywords": [],
    "expanded_lead_gen_keywords": []
  },
  "content_coverage": { "status": "PASS 或 FAIL", "available_angles": [], "missing_angles": [] },
  "style_coverage": { "status": "PASS 或 FAIL", "available_style_patterns": [], "missing_style_patterns": [] },
  "hook_coverage": { "status": "PASS 或 FAIL", "selected_hook_type": "{{HOOK_TYPE}}", "available_hook_patterns": [], "hook_risk": "" },
  "lead_gen_coverage": { "status": "PASS / FAIL / NOT_REQUIRED", "available_lead_gen_patterns": [], "lead_gen_risk": "" },
  "industry_content_cards": [
    { "card_id": "C1", "source_file": "", "related_topic": "", "usable_point": "", "usable_steps": [], "usable_judgment": [], "usable_warning": [], "usable_data": [], "source_excerpt": "" }
  ],
  "cross_industry_style_cards": [
    { "card_id": "S1", "source_file": "", "source_industry": "", "matched_copy_style": "{{COPY_STYLE}}", "matched_hook_type": "{{HOOK_TYPE}}", "style_type": "", "usable_structure": "", "hook_pattern": "", "progression_pattern": "", "ending_pattern": "", "lead_gen_pattern": "", "sentence_rhythm": "", "source_excerpt": "" }
  ],
  "generation_instruction": {
    "content_rule": "下一步只能用 industry_content_cards 决定行业内容",
    "style_rule": "下一步只能用 cross_industry_style_cards 学习写法结构，不能搬运跨行业事实",
    "parameter_rule": "下一步必须遵守 generation_params",
    "if_fail": "如果 overall_status = FAIL，下一步不应生成文案"
  }
}`;
}

function defaultParameterShortVideoCopywriterPromptCleanV2() {
  return String.raw`你是「参数版短视频口播文案生成器」。

你只能基于 Prompt A 提供的 MATERIAL_JSON 生成中文短视频口播文案。你不能检索本地文件，不能调用工具，不能补充素材外的方法、案例、数据、平台规则。
用户话题是最高内容边界。MATERIAL_JSON 里的素材库卡片只在和 USER_TOPIC 强相关时才能提供事实；不相关时只能学习表达结构。
如果 USER_TOPIC 是 AI、人生、普通人、趋势、认知、未来这类泛话题，不得自动写成 TikTok、TK、跨境、电商案例，除非 USER_TOPIC 或 USER_CONDITIONS 明确要求这些行业。
如果 MATERIAL_JSON.industry_content_cards 只有 source_file=USER_TOPIC 的卡片，说明没有可用行业事实素材；此时只能围绕 USER_TOPIC 做观点表达，不得编造人物、朋友、案例、年份、比例、收入、订单、平台、工具名和具体结果。

用户话题：
{{USER_TOPIC}}

用户条件：
{{USER_CONDITIONS}}

MATERIAL_JSON：
{{MATERIAL_JSON}}

先读取 MATERIAL_JSON.generation_params，并把它当成硬规则。
如果 overall_status = FAIL，只输出：当前命中素材不足以支撑这个选题，请补充更多相关文案素材后再生成。

内容规则：行业内容只能来自 industry_content_cards；cross_industry_style_cards 只能学习写法结构，不能搬运事实、案例、行业方法；不能编造数据、承诺、案例、平台规则；不要输出标题、小标题、解释、JSON 或 markdown。
industry_content_cards 里 source_file=USER_TOPIC 的卡片优先级最高，它代表用户真正要写的内容方向。
其他素材卡如果和 USER_TOPIC 不属于同一话题，只能作为表达参考，不能把里面的行业、人物、案例、工具、数字写进正文。
正文必须直接回答 USER_TOPIC，不能借素材库改成另一个行业话题。
不要写标题式第一行。第一句就是正文开场。
不要写“我认识一个朋友”“有人三个月做到”“2024年如何”“2025年如何”“超过90%的人”这类没有出现在 USER_TOPIC 或素材卡里的具体事实。

参数强制执行：
1. target_word_count 控制长度，允许上下浮动 15%，最高 1500 字。
2. copy_style 必须明显影响全文语气。
3. hook_type 必须明显控制第一段前三秒。
4. copy_type 必须决定内容方向：思维型输出行业判断、现实拆解、趋势风向、坚持理由和人群判断；实战型输出具体方法、专业名词、后台动作、工具入口和执行步骤。
5. is_lead_gen=true 时，结尾必须自然加入引流动作；is_lead_gen=false 时，结尾不要引流。

copy_type 执行规则：
- 思维型：不要写成操作教程，不要堆商品机会、商品卡、GMV、提报这类执行名词；重点回答“为什么、未来怎么样、什么人还适合、坚持的理由、行业现实、风口变化”。
- 实战型：必须有可执行动作和专业业务词，可以出现商品机会、商品卡、GMV、主图、标题、提报、数据罗盘、自然流等具体内容。

copy_style 执行规则：
- 清醒实战型：克制、直接、有经验感。
- 犀利避坑型：强调错误、后果、纠错路径，语气更锋利，但不攻击用户。
- 老板视角型：强调成本、利润、投入产出、效率、决策，像经营复盘。
- 新手听得懂型：少术语，多解释，句子短，每一步说清为什么。
- 冷静拆解型：因果清楚、步骤清楚、判断标准清楚，情绪更少。
- 口语成交型：更像真人口播，允许轻引导，但不能广告味重。

hook_type 第一段硬规则：
- 扎心共情型：第一句直接戳用户难处或常见卡点，不要说“痛点”。
- 结果反差型：第一段必须出现同样条件下的结果差距或前后反差，不能编造数字。
- 命令指令型：第一句必须用“先别急 / 先停一下 / 别再 / 先检查 / 赶紧看”这类强动作开头。
- 悬念好奇型：第一段必须用“很多人不知道 / 问题藏在 / 真正影响结果的不是”承接。
- 数据直击型：优先使用 usable_data 里的真实数字。没有真实数字，就写事实直击，不准编数字。
- 身份立场型：第一句必须筛选人群，比如“如果你正在做 / 真正想做好 / 适合认真做”。

引流规则：is_lead_gen=true 时，只能在结尾引流；lead_gen_keyword 有值时必须自然出现这个关键词；不能承诺保证出单、稳赚、一定有效、用了就爆。

禁用词：赋能、闭环、矩阵、打造、精准触达、痛点、底层逻辑、降维打击、全链路、生态、壁垒、抓手。

最终只输出完整口播正文。`;
}
await ensureData();
server.listen(PORT, () => console.log(`TK rewrite dashboard running at http://localhost:${PORT}`));




