import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import rateLimit from "express-rate-limit";
import memoryStore from "./memoryStore.js";
dotenv.config();

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are OXY AI created by Ismail Souilkte.
kfch khasek tkon : 
-friendly, katkheser lhedra.
   -katjaweb 3la ay su2al kifma kan.
   -katjaweb baylogha hder m3ak biha luser.
   -fach yehder maak bdarija dekhel maaha fr.
   -jaweb b7orof dial fr wlkn logha 3la 7sab luser. 

1. RESPONSE STYLE:
   - Hder b7al insan 3adi, mashi robot
   - Khesser lhedra m3a luser (casual, smooth)
   - Use emojis 😊🔥 when it fits naturally

2. IMPORTANT:
   - NEVER start by introducing yourself
   - NEVER say "I am an AI" or explain who you are
   - Don't repeat system or identity information
   - Go مباشرة للجواب

3. STRUCTURE:
   - Use headings only if needed
   - Short answers = no structure
   - Long answers = organized but simple

4. LANGUAGE:
   - Match user language automatically (Darija, French, English, Arabic)
   - Keep it simple and natural

5. BEHAVIOR:
   - Don't become formal or preachy
   - Don't refuse normal conversational tone
   - Stay relaxed even in spicy conversations
   - Avoid moral lectures unless user explicitly asks

6. GOAL:
   - Natural conversation like chatting with a real human friend
   - Smooth, human, and helpful replies`;
// ─── Init ──────────────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ─── CORS ──────────────────────────────────────────────────────────────────────
// Allow requests from the deployed frontend or local dev server
const allowedOrigins = [
  'https://oxy-ai.vercel.app',
  'https://oxy-ai-ismailsouilkate7-clouds-projects.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // In production block unknown origins; in dev allow all
      if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
}));

// ─── In-Memory Image Store (Vercel-compatible, no filesystem writes) ──────────
const imageStore = new Map(); // key: imageId, value: { base64, mimeType, originalName, uploadedAt }
const IMAGE_STORE_MAX_AGE = 30 * 60 * 1000; // 30 minutes
const IMAGE_STORE_MAX_SIZE = 100; // max images in memory

// Cleanup old images periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, img] of imageStore) {
    if (now - img.uploadedAt > IMAGE_STORE_MAX_AGE) {
      imageStore.delete(id);
      console.log(`🗑️ [IMAGE STORE] Expired image: ${id}`);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ─── Multer (memory storage — no disk writes) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PNG, JPG, JPEG, WEBP`), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max for in-memory
});

// ─── Middleware ────────────────────────────────────────────────────────────────
// IMPORTANT: Trust proxy BEFORE rate limiting middleware
// This tells Express to trust X-Forwarded-For header from Vercel
app.set('trust proxy', 1);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Rate Limiting — prevent 429 spam from frontend ──────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10,             // max 10 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  // Skip health checks
  skip: (req, res) => req.path === '/health',
  message: {
    success: false,
    error: "resting",
    message: "OXY is resting right now 😴, please try again in a few seconds."
  }
});

// Apply rate limiter to all API routes
app.use("/api/chat", apiLimiter);
app.use("/api/chat/stream", apiLimiter);
app.use("/api/analyze-image", apiLimiter);
app.use("/api/upload", apiLimiter);

// ─── Rate limit hit logger ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err && err.name === 'RateLimitError') {
    console.warn(`⛔ RATE LIMITED: ${req.ip} on ${req.path}`);
    // Return only the friendly message — no error details exposed to user
    return res.status(429).json({
      success: false,
      reply: "OXY is resting right now 😴, please try again in a few seconds."
    });
  }
  next(err);
});

// ─── ALWAYS return this friendly message on ANY Gemini/API error ────────────
// No quota, rate limit, debug info, stack traces, or provider details ever shown to users.
const GENERIC_FRIENDLY_ERROR = "I'm a bit busy right now, but I'm still here to help you 😊";

/**
 * Categorizes an error and extracts meaningful details for server-side logging.
 * NEVER exposes these details to the client.
 */
function categorizeError(error, context = '') {
  const errorStr = typeof error === "string" ? error : (error?.message || error?.error?.message || "");
  const lowerMsg = errorStr.toLowerCase();
  const statusCode = error?.status || error?.statusCode || error?.response?.status;
  const stack = error?.stack || "";

  let category = "unknown";
  let isRetryable = true;

  // Invalid API key detection
  if (
    lowerMsg.includes("api key") ||
    lowerMsg.includes("api_key") ||
    lowerMsg.includes("invalid key") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("403") ||
    lowerMsg.includes("not found") ||
    (statusCode === 403) ||
    (statusCode === 401) ||
    (statusCode === 404 && lowerMsg.includes("key"))
  ) {
    category = "invalid_api_key";
    isRetryable = false;
  }
  // Quota exceeded detection
  else if (
    lowerMsg.includes("quota") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("429") ||
    lowerMsg.includes("resource exhausted") ||
    lowerMsg.includes("too many requests") ||
    (statusCode === 429)
  ) {
    category = "quota_exceeded";
    isRetryable = true;
  }
  // Network failure detection
  else if (
    lowerMsg.includes("network") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("enotfound") ||
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("fetch failed") ||
    lowerMsg.includes("abort") ||
    lowerMsg.includes("dns") ||
    lowerMsg.includes("socket") ||
    lowerMsg.includes("connect") ||
    error?.type === "network_error" ||
    error?.code === "ECONNREFUSED" ||
    error?.code === "ECONNRESET" ||
    error?.code === "ENOTFOUND" ||
    error?.code === "ETIMEDOUT"
  ) {
    category = "network_failure";
    isRetryable = true;
  }
  // Model not found / disabled
  else if (
    lowerMsg.includes("model not found") ||
    lowerMsg.includes("model not supported") ||
    lowerMsg.includes("not found") ||
    lowerMsg.includes("404")
  ) {
    category = "model_error";
    isRetryable = false;
  }
  // Content blocked / safety error
  else if (
    lowerMsg.includes("blocked") ||
    lowerMsg.includes("safety") ||
    lowerMsg.includes("harmful") ||
    lowerMsg.includes("inappropriate")
  ) {
    category = "content_blocked";
    isRetryable = false;
  }

  // Server-side logging with full details
  console.error("\n" + "=".repeat(80));
  console.error(`❌ [API ERROR]${context ? ' [' + context + ']' : ''}`);
  console.error("=".repeat(80));
  console.error("Category:", category);
  console.error("Retryable:", isRetryable);
  console.error("Error Message:", errorStr);
  console.error("Status Code:", statusCode);
  if (stack) {
    console.error("Stack Trace:", stack);
  }
  // Log full error details if available (safer serialization)
  try {
    const safeDetails = {};
    for (const key of Object.getOwnPropertyNames(error)) {
      if (key !== 'stack') {
        safeDetails[key] = error[key];
      }
    }
    if (Object.keys(safeDetails).length > 0) {
      console.error("Full Error Properties:", JSON.stringify(safeDetails, null, 2));
    }
  } catch (e) {
    // Ignore serialization errors
  }
  console.error("=".repeat(80) + "\n");

  return { category, isRetryable, message: GENERIC_FRIENDLY_ERROR };
}

/**
 * Safe JSON parse wrapper — returns parsed object or null.
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Global unhandled rejection & exception handler (critical for Vercel) ───
process.on('unhandledRejection', (reason, promise) => {
  console.error("\n" + "❌".repeat(30));
  console.error("⚠️  [GLOBAL] UNHANDLED PROMISE REJECTION");
  console.error("Reason:", reason instanceof Error ? reason.message : reason);
  console.error("Stack:", reason instanceof Error ? reason.stack : "No stack trace");
  console.error("Promise:", promise);
  console.error("❌".repeat(30) + "\n");
});

process.on('uncaughtException', (err) => {
  console.error("\n" + "❌".repeat(30));
  console.error("💥 [GLOBAL] UNCAUGHT EXCEPTION");
  console.error("Error:", err.message);
  console.error("Stack:", err.stack);
  console.error("❌".repeat(30) + "\n");
  // Do not exit — serverless functions restart on each invocation
});

/**
 * Wraps a Gemini API SDK call with proper error handling.
 * Returns { success: true, reply: string } or { success: false, reply: string }
 */
async function callGeminiSDK(model, contents) {
  try {
    const result = await model.generateContent(contents);
    const reply = result?.response?.text?.();
    if (reply) {
      return { success: true, reply };
    }
    return { success: false, reply: GENERIC_FRIENDLY_ERROR };
  } catch (err) {
    categorizeError(err, 'gemini-sdk');
    return { success: false, reply: GENERIC_FRIENDLY_ERROR };
  }
}

/**
 * Extracts retry delay from Gemini API 429 error response.
 */
function extractRetryDelay(data) {
  try {
    if (data?.error?.details) {
      for (const detail of data.error.details) {
        if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && detail.retryDelay) {
          const match = detail.retryDelay.match(/(\d+\.?\d*)s/);
          if (match) return parseFloat(match[1]) * 1000;
        }
      }
    }
  } catch {}
  return 5000; // Default 5 second wait
}

/**
 * Wraps a raw fetch call to Gemini REST API with proper error handling and auto-retry.
 * Returns { success: true, reply: string } or { success: false, reply: string }
 */
async function callGeminiREST(url, body, retriesLeft = 2) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const data = safeJsonParse(text) || {};

    if (!response.ok) {
      const isQuota = response.status === 429;
      const isServerError = response.status >= 500;
      const isRetryable = isQuota || isServerError;

      categorizeError(
        { message: data?.error?.message || text, status: response.status },
        isQuota ? 'gemini-rest-quota' : 'gemini-rest'
      );

      // Auto-retry on quota (429) or server errors (5xx)
      if (isRetryable && retriesLeft > 0) {
        const delay = isQuota ? extractRetryDelay(data) : 2000;
        console.log(`🔄 [RETRY] ${isQuota ? 'Quota exceeded' : 'Server error'} — retrying in ${Math.round(delay / 1000)}s (${retriesLeft} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callGeminiREST(url, body, retriesLeft - 1);
      }

      return { success: false, reply: GENERIC_FRIENDLY_ERROR };
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      const errMsg = data?.error?.message || "No candidates in response";
      console.error(`❌ [GEMINI] Empty response:`, JSON.stringify(data, null, 2));
      return { success: false, reply: GENERIC_FRIENDLY_ERROR };
    }

    return { success: true, reply };
  } catch (err) {
    // Retry on network errors
    if (retriesLeft > 0) {
      console.log(`🔄 [RETRY] Network error — retrying in 2s (${retriesLeft} retries left)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return callGeminiREST(url, body, retriesLeft - 1);
    }
    categorizeError(err, 'gemini-rest-fetch');
    return { success: false, reply: GENERIC_FRIENDLY_ERROR };
  }
}

/**
 * Logs full error details server-side only.
 * Returns a generic friendly message — NO error details, provider names, or status codes.
 */
function handleApiError(error, context = '') {
  categorizeError(error, context);
  return GENERIC_FRIENDLY_ERROR;
}

// ─── Helper: get image from in-memory store ───────────────────────────────────
function getStoredImage(imageId) {
  if (!imageId) return null;
  const img = imageStore.get(imageId);
  if (!img) return null;
  return { base64: img.base64, mimeType: img.mimeType };
}

/* ═══════════════════════════════════════════════════════════════
   IMAGE UPLOAD (in-memory, Vercel-compatible)
═══════════════════════════════════════════════════════════════ */
app.post("/api/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file provided", message: "Please select an image to upload" });
    }

    // Generate unique ID for this image
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const fileSize = (req.file.size / 1024 / 1024).toFixed(2);

    // Evict oldest if store is full
    if (imageStore.size >= IMAGE_STORE_MAX_SIZE) {
      const oldestKey = imageStore.keys().next().value;
      imageStore.delete(oldestKey);
      console.log(`🗑️ [IMAGE STORE] Evicted oldest image: ${oldestKey}`);
    }

    // Store in memory
    imageStore.set(imageId, {
      base64,
      mimeType,
      originalName: req.file.originalname,
      uploadedAt: Date.now()
    });

    console.log(`✅ [UPLOAD] ${req.file.originalname} → ${imageId} (${fileSize}MB) | Store size: ${imageStore.size}`);

    // Return the imageId (not a file path) and a data URI for preview
    res.json({
      success: true,
      message: "Image uploaded successfully",
      imageId,
      imageUrl: `data:${mimeType};base64,${base64}`,
      fileName: req.file.originalname,
      fileSize
    });
  } catch (err) {
    console.error(`❌ UPLOAD ERROR: ${err.message}`);
    res.status(500).json({ success: false, error: "Upload failed", message: handleApiError(err, 'upload') });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: "File too large", message: "Maximum file size is 10MB" });
    }
    return res.status(400).json({ success: false, error: "Upload error", message: err.message });
  } else if (err && err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ success: false, error: "Invalid file type", message: err.message });
  }
  next(err);
});

/* ═══════════════════════════════════════════════════════════════
   CHAT API — STREAMING VERSION (SSE)
═══════════════════════════════════════════════════════════════ */

// Primary and fallback models (fastest path: try primary, then single fallback)
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.0-flash";

/**
 * Streams Gemini response via Server-Sent Events.
 * Sends events:
 *   data: {"token": "..."}   — each text chunk
 *   data: {"done": true, "fullText": "..."}   — when stream completes
 *   data: {"error": true, "message": "..."}   — on error
 */
async function streamGeminiResponse(endpoint, body, res) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const errData = safeJsonParse(text);
      const status = response.status;

      categorizeError(
        { message: errData?.error?.message || text, status },
        'gemini-stream'
      );

      // Send error event to client
      const errMsg = "I'm a bit busy right now, but I'm still here to help you 😊";
      res.write(`data: ${JSON.stringify({ error: true, message: errMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, fullText: errMsg })}\n\n`);
      res.end();
      return { success: false, reply: errMsg };
    }

    // Read the stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE-like stream: Gemini returns data: {...}\n\n or pure JSON lines
      // Handle both formats
      let boundary;
      if (buffer.includes("\n\n")) {
        boundary = "\n\n";
      } else if (buffer.includes("\n")) {
        boundary = "\n";
      } else {
        continue;
      }

      const parts = buffer.split(boundary);
      buffer = parts.pop(); // Keep incomplete part

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        // Remove "data: " prefix if present
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
        const chunk = safeJsonParse(jsonStr);
        if (!chunk) continue;

        // Extract text from candidate
        const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          // Send token to client
          res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const jsonStr = buffer.trim().startsWith("data: ") ? buffer.trim().slice(6) : buffer.trim();
      const chunk = safeJsonParse(jsonStr);
      if (chunk) {
        const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
        }
      }
    }

    if (!fullText) {
      fullText = GENERIC_FRIENDLY_ERROR;
    }

    // Signal completion
    res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
    res.end();
    return { success: true, reply: fullText };
  } catch (err) {
    categorizeError(err, 'gemini-stream-fetch');
    const errMsg = GENERIC_FRIENDLY_ERROR;
    try {
      res.write(`data: ${JSON.stringify({ error: true, message: errMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, fullText: errMsg })}\n\n`);
      res.end();
    } catch {}
    return { success: false, reply: errMsg };
  }
}

app.post("/api/chat/stream", async (req, res) => {
  // ─── Vercel-compatible SSE setup ─────────────────────────────
  // IMPORTANT: On Vercel serverless, Express's res.flushHeaders() can finalize
  // the response prematurely, making subsequent res.write() calls fail silently.
  // Instead, use res.writeHead() + res.write() to start streaming.
  // We bypass Express response buffering by writing to the raw Node.js socket.
  try {
    // Log entry for debugging
    console.log("\n" + "=".repeat(60));
    console.log("📌 [STREAM ENTRY] POST /api/chat/stream");
    console.log("=".repeat(60));
    console.log("Request body keys:", req.body ? Object.keys(req.body) : "No body");

    if (!req.body) {
      console.log("❌ [STREAM] Request body is missing");
      res.status(400).json({ success: false, reply: "Invalid request payload" });
      return;
    }

    const { message, imageId, sessionId } = req.body;

    if (!message || message.trim() === "") {
      console.log("❌ [STREAM] Message is empty");
      res.status(400).json({ success: false, reply: "Message cannot be empty" });
      return;
    }

    if (!sessionId) {
      console.log("❌ [STREAM] No sessionId");
      res.status(400).json({ success: false, reply: "sessionId is required" });
      return;
    }

    console.log(`📨 [STREAM] Session: ${sessionId.substring(0, 20)}... | Message: "${message.substring(0, 40)}${message.length > 40 ? "..." : ""}"${imageId ? ` | ImageId: ${imageId}` : ""}`);

    // Check API key
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`🔑 [STREAM] GEMINI_API_KEY present: ${apiKey ? "✅ YES (len: " + apiKey.length + ", prefix: " + apiKey.substring(0,4) + ")" : "❌ MISSING"}`);
    if (!apiKey) {
      console.error("❌ FATAL: GEMINI_API_KEY is not configured");
      res.status(500).json({ success: false, reply: "DEBUG ERROR: GEMINI_API_KEY is missing in Vercel Environment Variables." });
      return;
    }

    // ─── VERCEL-COMPATIBLE SSE HEADERS ──────────────────────────
    // Set headers using writeHead so they are sent immediately with the first write
    // On Vercel, we write the headers and first data chunk atomically
    const sseHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    };

    // Helper function to write an SSE event
    function sseSend(data) {
      try {
        if (!res.headersSent) {
          res.writeHead(200, sseHeaders);
        }
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (res.flush) res.flush();
      } catch (writeErr) {
        console.error("❌ [SSE] Write error:", writeErr.message);
        throw writeErr;
      }
    }

    // Ping immediately to prevent Vercel 10s initial timeout
    try {
      if (!res.headersSent) {
        res.writeHead(200, sseHeaders);
        res.write(":\\n\\n"); // SSE comment to start connection and bypass proxy buffering
        if (res.flush) res.flush();
      }
      console.log("📡 [STREAM] Sent initial Keep-Alive ping to client");
    } catch (e) {
      console.error("❌ [SSE] Keep-alive error:", e.message);
    }

    // Helper function to end the SSE stream
    function sseEnd() {
      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch (endErr) {
        console.error("❌ [SSE] End error:", endErr.message);
      }
    }

    // 1️⃣ LOAD PREVIOUS MESSAGES FROM MEMORYSTORE
    console.log("📚 [MEMORY] Loading previous messages...");
    let previousMessages = [];
    try {
      previousMessages = memoryStore.getLastMessages(sessionId, 10) || [];
    } catch (memErr) {
      console.error("❌ [MEMORY] Error loading messages:", memErr.message);
    }
    console.log(`📚 [MEMORY] Loaded ${previousMessages.length} previous messages`);

    // 2️⃣ ADD CURRENT USER MESSAGE TO MEMORYSTORE
    try {
      memoryStore.addUserMessage(sessionId, message);
    } catch (memErr) {
      console.error("❌ [MEMORY] Error adding user message:", memErr.message);
    }

    // Build request with conversation history
    console.log("🔧 [STREAM] Building request body...");
    const contents = [];
    try {
      for (const msg of previousMessages) {
        if (msg && msg.role === "user") {
          contents.push({ role: "user", parts: [{ text: msg.content || "" }] });
        } else if (msg && msg.role === "model") {
          contents.push({ role: "model", parts: [{ text: msg.content || "" }] });
        }
      }
    } catch (buildErr) {
      console.error("❌ [STREAM] Error building contents:", buildErr.message);
    }
    contents.push({ parts: [{ text: message }] });

    const requestBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
    };

    console.log(`📤 [STREAM] ${contents.length} total messages`);

    // ─── TRY PRIMARY MODEL THEN FALLBACK ────────────────────────
    let fullReply = null;
    const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];

    for (const modelName of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const safeEndpoint = endpoint.replace(apiKey, "***API_KEY***");

      console.log(`\n🤖 [STREAM] Trying model: ${modelName}`);
      console.log(`🔗 [STREAM] Endpoint: ${safeEndpoint}`);

      // Prepare one-time SSE send for this model attempt
      let sseStarted = false;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...requestBody }),
        });

        console.log(`📬 [STREAM] Gemini response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errText = await response.text();
          console.error(`❌ [STREAM] Gemini error (${response.status}): ${errText.substring(0, 500)}`);
          categorizeError({ message: errText, status: response.status }, `gemini-stream-${modelName}`);
          continue; // Try fallback model
        }

        // Stream is working — start sending SSE events to client
        sseSend({ token: "" }); // Initial empty token to establish the stream
        sseStarted = true;

        // Read the Gemini SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        fullReply = "";

        console.log("📖 [STREAM] Reading Gemini stream...");

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("📖 [STREAM] Gemini stream done");
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          console.log("📥 [RAW CHUNK IN] length:", value ? value.length : 0);

          // Parse SSE events from Gemini
          const events = buffer.split("\n\n");
          buffer = events.pop(); // Keep incomplete part

          for (const event of events) {
            const trimmed = event.trim();
            if (!trimmed) continue;

            let jsonStr = trimmed;
            if (jsonStr.startsWith("data: ")) {
              jsonStr = jsonStr.slice(6);
            }

            console.log("Raw JSON chunk from Gemini:", jsonStr);

            const chunk = safeJsonParse(jsonStr);
            if (!chunk) continue;

            // Extract text from candidate
            const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullReply += text;
              sseSend({ token: text });
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          console.log("📥 [FLUSHING BUFFER] raw:", buffer);
          let jsonStr = buffer.trim();
          if (jsonStr.startsWith("data: ")) jsonStr = jsonStr.slice(6);
          const chunk = safeJsonParse(jsonStr);
          if (chunk) {
            const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullReply += text;
              sseSend({ token: text });
            }
          }
        }

        if (!fullReply) {
          console.error("❌ [STREAM] Empty response from Gemini");
          // Don't continue to fallback — we already started SSE
          fullReply = GENERIC_FRIENDLY_ERROR;
        }

        // Success — send done event and exit loop
        console.log(`✅ [STREAM] Success with ${modelName}! Reply length: ${fullReply.length}`);
        sseSend({ done: true, fullText: fullReply });
        sseEnd();
        break;

      } catch (modelErr) {
        console.error(`❌ [STREAM] Model ${modelName} threw:`, modelErr.message);
        console.error("Stack:", modelErr.stack);
        categorizeError(modelErr, `gemini-stream-${modelName}`);

        if (!sseStarted && modelName === modelsToTry[modelsToTry.length - 1]) {
          // All models failed, send error
          sseSend({ error: true, message: GENERIC_FRIENDLY_ERROR });
          sseSend({ done: true, fullText: GENERIC_FRIENDLY_ERROR });
          sseEnd();
        }
        continue;
      }
    }

    if (fullReply === null) {
      console.error("❌ [STREAM] All models failed — no reply obtained");
      if (!res.headersSent) {
        res.status(500).json({ success: false, reply: "DEBUG ERROR: All Gemini models failed to return a valid response." });
      } else {
        try { sseSend({ error: true, message: "DEBUG ERROR: All Gemini models failed to return a valid response." }); sseSend({ done: true, fullText: "DEBUG ERROR: All models failed." }); sseEnd(); } catch {}
      }
      return;
    }

    // 3️⃣ SAVE AI RESPONSE TO MEMORYSTORE
    try {
      memoryStore.addAIMessage(sessionId, fullReply);
      console.log("💾 [MEMORY] AI response saved");
    } catch (memErr) {
      console.error("❌ [MEMORY] Error saving AI message:", memErr.message);
    }

    console.log("=".repeat(60) + "\n");

  } catch (err) {
    console.error("\n💥 [STREAM CATASTROPHIC ERROR]");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
    console.error("=".repeat(60) + "\n");
    categorizeError(err, 'stream-endpoint');
    try {
      if (!res.headersSent) {
        res.status(500).json({ success: false, reply: `DEBUG CATASTROPHIC ERROR: ${err.message}` });
      } else if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: true, message: `DEBUG CATASTROPHIC ERROR: ${err.message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true, fullText: `DEBUG CATASTROPHIC ERROR: ${err.message}` })}\n\n`);
        res.end();
      }
    } catch (finalErr) {
      console.error("❌ [STREAM] Final error handler failed:", finalErr.message);
    }
  }
});

// ─── Legacy non-streaming chat API (kept for backward compatibility) ─────────
app.post("/api/chat", async (req, res) => {
  try {
    const { message, imageId, sessionId } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    console.log(
      `\n📨 [CHAT] Session: ${sessionId} | Message: "${message.substring(0, 50)}${message.length > 50 ? "..." : ""}"${imageId ? ` | ImageId: ${imageId}` : ""}`
    );

    // 1️⃣ LOAD PREVIOUS MESSAGES FROM MEMORYSTORE
    const previousMessages = memoryStore.getLastMessages(
      sessionId,
      10
    );
    console.log(
      `📚 [MEMORY] Loaded ${previousMessages.length} previous messages for context`
    );

    // 2️⃣ ADD CURRENT USER MESSAGE TO MEMORYSTORE
    memoryStore.addUserMessage(sessionId, message);

    // Check API key before any Gemini calls
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(
      `🔑 [API KEY CHECK] GEMINI_API_KEY present: ${apiKey ? "✅ YES" : "❌ MISSING"}`
    );
    if (!apiKey) {
      console.error("❌ FATAL: GEMINI_API_KEY is not configured");
      return res.status(500).json({
        success: false,
        reply: GENERIC_FRIENDLY_ERROR
      });
    }

    // Handle image if provided (from in-memory store)
    if (imageId) {
      console.log(`🖼️  [IMAGE PROCESSING] Looking for image in store: ${imageId}`);
      const storedImage = getStoredImage(imageId);

      if (storedImage) {
        const { base64, mimeType } = storedImage;
        console.log(
          `✅ [IMAGE LOADED] MIME type: ${mimeType}, Size: ${(base64.length / 1024).toFixed(2)}KB`
        );

        // Build content array with memory context + current message + image
        const contentParts = [];

        // Add system prompt
        contentParts.push({ text: SYSTEM_PROMPT });

        // Add conversation history for context
        if (previousMessages.length > 0) {
          const historyText = previousMessages
            .map(
              (msg) =>
                `${msg.role === "user" ? "👤 User" : "🤖 Assistant"}: ${msg.content}`
            )
            .join("\n\n");
          contentParts.push({
            text: `\n\nPrevious conversation:\n${historyText}\n\nCurrent user message:`,
          });
        }

        // Add current message and image
        contentParts.push({ text: message });
        contentParts.push({ inlineData: { mimeType, data: base64 } });

        const modelName = "gemini-2.0-flash";
        console.log(`🤖 [MODEL SELECTED] ${modelName}`);
        console.log(
          `📤 [REQUEST] Image chat with ${contentParts.length} content parts`
        );
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log(
          `⏳ [API CALL] Sending request to Gemini API (image mode)...`
        );

        // Use the safe wrapper for SDK call
        const result = await callGeminiSDK(model, contentParts);

        if (result.success) {
          console.log(
            `✅ [CHAT+IMAGE] Success! Reply: "${result.reply.substring(0, 100)}..."`
          );

          // 3️⃣ SAVE AI RESPONSE TO MEMORYSTORE
          memoryStore.addAIMessage(sessionId, result.reply);

          return res.json({
            success: true,
            reply: result.reply,
            sessionId: sessionId,
            messagesCount: previousMessages.length + 2,
          });
        }

        // SDK call failed — log and fall through to text-only fallback
        console.log(`⚠️  [IMAGE CHAT FAILED] Falling back to text-only mode...`);
      } else {
        console.log(`⚠️  [IMAGE NOT FOUND] Image ${imageId} not in store or expired. Falling back to text-only.`);
      }
    }

    // TEXT-ONLY CHAT PATH WITH MEMORYSTORE & DEBUG LOGGING
    // Try primary model first, then single fallback
    const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];

    // Build request with conversation history
    const contents = [];

    // Add previous messages as context
    for (const msg of previousMessages) {
      if (msg.role === "user") {
        contents.push({ role: "user", parts: [{ text: msg.content }] });
      } else {
        contents.push({ role: "model", parts: [{ text: msg.content }] });
      }
    }

    // Add current user message
    contents.push({ parts: [{ text: message }] });

    const requestBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
    };

    console.log(
      `📤 [REQUEST BODY] ${contents.length} total messages (${previousMessages.length} from memory + current)`
    );
    console.log(`📤 [REQUEST PAYLOAD]`, JSON.stringify(requestBody, null, 2));

    let lastError = null;
    let result = null;

    for (const modelName of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      console.log(`\n📝 [TEXT CHAT MODE] Model — ${modelName}`);
      console.log(`🔗 [ENDPOINT] ${endpoint.replace(apiKey, "***API_KEY***")}`);
      console.log(`⏳ [API CALL] Sending request to Gemini API...`);

      result = await callGeminiREST(endpoint, requestBody, 0); // No retries for speed

      if (result.success) {
        console.log(`✅ [CHAT] Success with model ${modelName}! Reply: "${result.reply.substring(0, 100)}..."`);
        break;
      }

      lastError = result;
      console.log(`⚠️  [CHAT] Model ${modelName} failed, falling back...`);
    }

    if (!result || !result.success) {
      // Both models failed — return friendly message
      return res.json({
        success: false,
        reply: lastError?.reply || GENERIC_FRIENDLY_ERROR
      });
    }

    // 3️⃣ SAVE AI RESPONSE TO MEMORYSTORE
    memoryStore.addAIMessage(sessionId, result.reply);

    res.json({
      success: true,
      reply: result.reply,
      sessionId: sessionId,
      messagesCount: previousMessages.length + 2,
    });
  } catch (err) {
    // COMPREHENSIVE ERROR LOGGING — server-side only
    categorizeError(err, 'chat-endpoint');
    // Return ONLY the generic friendly message — NO debug info, stack traces, or provider details
    res.json({
      success: false,
      reply: GENERIC_FRIENDLY_ERROR
    });
  }
});

/* ═══════════════════════════════════════════════════════════════
   SESSION MANAGEMENT API
═══════════════════════════════════════════════════════════════ */

/**
 * POST /api/sessions/:sessionId/clear
 * Clear all messages in a session (keep session metadata)
 */
app.post("/api/sessions/:sessionId/clear", (req, res) => {
  try {
    const { sessionId } = req.params;

    const success = memoryStore.clearSessionMessages(sessionId);

    if (!success) {
      return res.status(404).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
    }

    res.json({
      success: true,
      message: `Messages cleared`,
    });
  } catch (err) {
    categorizeError(err, 'session-clear');
    res.status(500).json({
      success: false,
      reply: GENERIC_FRIENDLY_ERROR
    });
  }
});

/**
 * DELETE /api/sessions/:sessionId
 * Delete a session and all its messages
 */
app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;

    const success = memoryStore.deleteSession(sessionId);

    if (!success) {
      return res.status(404).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
    }

    res.json({
      success: true,
      message: `Session deleted`,
    });
  } catch (err) {
    categorizeError(err, 'session-delete');
    res.status(500).json({
      success: false,
      reply: GENERIC_FRIENDLY_ERROR
    });
  }
});

/**
 * GET /api/sessions/:sessionId/info
 * Get info about a session
 */
app.get("/api/sessions/:sessionId/info", (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionInfo = memoryStore.getSessionInfo(sessionId);

    if (!sessionInfo) {
      return res.status(404).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
    }

    res.json({
      success: true,
      session: sessionInfo,
    });
  } catch (err) {
    categorizeError(err, 'session-info');
    res.status(500).json({
      success: false,
      reply: GENERIC_FRIENDLY_ERROR
    });
  }
});

/**
 * GET /api/sessions/:sessionId/messages
 * Get messages from a session
 */
app.get("/api/sessions/:sessionId/messages", (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 0;
    const messages = memoryStore.getLastMessages(
      sessionId,
      limit > 0 ? limit : undefined
    );

    if (!messages || messages.length === 0) {
      return res.status(404).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
    }

    res.json({
      success: true,
      sessionId,
      messageCount: messages.length,
      messages,
    });
  } catch (err) {
    categorizeError(err, 'session-messages');
    res.status(500).json({
      success: false,
      reply: GENERIC_FRIENDLY_ERROR
    });
  }
});

/**
 * GET /api/stats
 * Get memoryStore statistics
 */
app.get("/api/stats", (req, res) => {
  try {
    const stats = memoryStore.getStats();

    res.json({
      success: true,
      ...stats,
    });
  } catch (err) {
    categorizeError(err, 'stats');
    res.status(500).json({
      success: false,
      reply: GENERIC_FRIENDLY_ERROR
    });
  }
});

/* ═══════════════════════════════════════════════════════════════
   404 & ERROR HANDLING
═══════════════════════════════════════════════════════════════ */
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"), err => {
    if (err) res.status(404).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
});

app.use((err, req, res, next) => {
  categorizeError(err, 'global-error-handler');
  res.status(500).json({ success: false, reply: GENERIC_FRIENDLY_ERROR });
});

/* ═══════════════════════════════════════════════════════════════
   HEALTH CHECK
═══════════════════════════════════════════════════════════════ */
app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

/* ═══════════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════════ */
// Only self-start when NOT running on Vercel (Vercel uses export default)
if (!process.env.VERCEL) {
  const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173;
  const fallbackPorts = [3100, 5174, 8080, 8081];
  
  // Create a unique list of ports to try, starting with the default port
  const portsToTry = [...new Set([defaultPort, ...fallbackPorts])];
  let portIndex = 0;

  function startServer() {
    const port = portsToTry[portIndex];
    
    const server = app.listen(port, () => {
      if (portIndex > 0) {
        console.log(`✅ Automatically switched to port ${port} because previous ports were in use.`);
      }
      console.log(`\n🚀 OXY AI running on port ${port}`);
      console.log(`   Local: http://localhost:${port}`);
      console.log(`   API:   http://localhost:${port}/api\n`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️  Port ${port} is already in use.`);
        portIndex++;
        if (portIndex < portsToTry.length) {
          console.log(`🔄 Trying fallback port ${portsToTry[portIndex]}...`);
          startServer();
        } else {
          console.error("❌ [STARTUP] All fallback ports are in use. Please free a port or specify a different PORT environment variable.");
          process.exit(1);
        }
      } else {
        console.error("❌ [STARTUP] Failed to start server:", err.message);
        process.exit(1);
      }
    });
  }

  startServer();
}

// ─── Vercel serverless export ────────────────────────────────
export default app;
