import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import rateLimit from "express-rate-limit";
import memoryStore from "./memoryStore.js"; // Changed from ConversationService
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
   - NEVER say “I am an AI” or explain who you are
   - Don’t repeat system or identity information
   - Go مباشرة للجواب

3. STRUCTURE:
   - Use headings only if needed
   - Short answers = no structure
   - Long answers = organized but simple

4. LANGUAGE:
   - Match user language automatically (Darija, French, English, Arabic)
   - Keep it simple and natural

5. BEHAVIOR:
   - Don’t become formal or preachy
   - Don’t refuse normal conversational tone
   - Stay relaxed even in spicy conversations
   - Avoid moral lectures unless user explicitly asks

6. GOAL:
   - Natural conversation like chatting with a real human friend
   - Smooth, human, and helpful replies`;
// ─── Init ──────────────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

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
// app.use(cors()); // Disabled to prevent unauthorized external access to API routes
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
  max: 8,              // max 8 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  // Use req.ip for proper IP detection when behind proxy (trust proxy enabled above)
  // Skip health checks if needed
  skip: (req, res) => req.path === '/health',
  message: {
    success: false,
    error: "rate_limited",
    message: "Too many requests, please wait a moment before sending another message."
  }
});

// Apply rate limiter to all API routes
app.use("/api/chat", apiLimiter);
app.use("/api/analyze-image", apiLimiter);
app.use("/api/upload", apiLimiter);

// ─── Rate limit hit logger ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err && err.name === 'RateLimitError') {
    console.warn(`⛔ RATE LIMITED: ${req.ip} on ${req.path}`);
    return res.status(429).json({
      success: false,
      error: "rate_limited",
      message: "Too many requests, please wait a moment."
    });
  }
  next(err);
});

// ─── Friendly error messages for Gemini API errors ────────────────────────────
const FRIENDLY_ERRORS = {
  '429': "🤖 Service temporairement saturé. 3awed jarrab ba3d chwia.",
  'quota': "🤖 lAI khaso yerta7 daba. Sbar chwia w 3awed jarrab.",
  'rate limit': "🤖 Kayn pressure 3la lservice daba. 3awed jarrab ba3d chwia.",
  'billing': "🤖 Problem f billing dyal API. Tchecki account dyalek.",
  'resource exhausted': "🤖 L’Ai khdam bzzaf daba. Sbar chwia.",
  'forbidden': "🤖 Access mmanou3. Tchecki ... key dyalek.",
  'default': "🤖 Service temporarily unavailable. 3awed jarrab ba3d chwia."
};

// ─── ENHANCED ERROR HANDLER WITH DEBUGGING ──────────────────────────────────
function getFriendlyErrorMessage(error, includeDebugInfo = false) {
  const errorStr =
    typeof error === "string"
      ? error
      : (error?.message || error?.error?.message || JSON.stringify(error || ""));

  const lower = errorStr.toLowerCase();
  const statusCode = error?.status || error?.statusCode;
  const stack = error?.stack || "No stack trace";

  // COMPREHENSIVE ERROR LOGGING
  console.error("\n" + "=".repeat(80));
  console.error("❌ [GEMINI API ERROR]");
  console.error("=".repeat(80));
  console.error("Error Message:", errorStr);
  console.error("Status Code:", statusCode);
  console.error("Error Object:", JSON.stringify(error, null, 2));
  console.error("Stack Trace:", stack);
  console.error("=".repeat(80) + "\n");

  // DEBUGGING MODE: Return actual error
  if (includeDebugInfo) {
    return `[DEBUG] ${statusCode || 'UNKNOWN'} - ${errorStr} | Stack: ${stack.split('\n')[1] || 'N/A'}`;
  }

  // PRIORITY 1: HTTP status codes
  if (statusCode === 429) {
    return FRIENDLY_ERRORS['429'];
  }

  if (statusCode === 403) {
    return FRIENDLY_ERRORS['forbidden'];
  }

  if (statusCode >= 500) {
    return "🤖 Server mouchkil daba. 3awed jarrab ba3d chwia.";
  }

  // PRIORITY 2: message keywords
  if (lower.includes("quota")) return FRIENDLY_ERRORS['quota'];
  if (lower.includes("rate limit")) return FRIENDLY_ERRORS['rate limit'];
  if (lower.includes("billing")) return FRIENDLY_ERRORS['billing'];
  if (lower.includes("resource exhausted")) return FRIENDLY_ERRORS['resource exhausted'];
  if (lower.includes("forbidden")) return FRIENDLY_ERRORS['forbidden'];

  // FINAL fallback (IMPORTANT FIX)
  return "🤖 Kayn mouchkil temporary f service. 3awed jarrab.";
}

// ─── Helper: get image from in-memory store ───────────────────────────────────
function getStoredImage(imageId) {
  if (!imageId) throw new Error('No image ID provided');
  const img = imageStore.get(imageId);
  if (!img) throw new Error(`Image not found in store: ${imageId}. It may have expired.`);
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
    res.status(500).json({ success: false, error: "Upload failed", message: err.message });
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
   CHAT API — WITH IN-MEMORY IMAGE SUPPORT
═══════════════════════════════════════════════════════════════ */
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
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(
      `🔑 [API KEY CHECK] GEMINI_API_KEY present: ${apiKey ? "✅ YES" : "❌ MISSING"}`
    );
    if (!apiKey) {
      const errorMsg = "❌ FATAL: GEMINI_API_KEY is not configured";
      console.error(errorMsg);
      return res.status(500).json({ error: "Server Error", message: errorMsg });
    }

    // Handle image if provided (from in-memory store)
    if (imageId) {
      try {
        console.log(`🖼️  [IMAGE PROCESSING] Reading image from store: ${imageId}`);
        const { base64, mimeType } = getStoredImage(imageId);
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

        const modelName = "gemini-2.5-flash";
        console.log(`🤖 [MODEL SELECTED] ${modelName}`);
        console.log(
          `📤 [REQUEST] Image chat with ${contentParts.length} content parts`
        );
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log(
          `⏳ [API CALL] Sending request to Gemini API (image mode)...`
        );
        const result = await model.generateContent(contentParts);
        console.log(`📬 [API RESPONSE] Received response from Gemini API`);
        const reply = result.response.text();

        console.log(
          `✅ [CHAT+IMAGE] Success! Reply: "${reply.substring(0, 100)}..."`
        );

        // 3️⃣ SAVE AI RESPONSE TO MEMORYSTORE
        memoryStore.addAIMessage(
          sessionId,
          reply
        );

        return res.json({
          reply,
          sessionId: sessionId,
          messagesCount: previousMessages.length + 2, // user + assistant
        });
      } catch (imgErr) {
        console.error(`\n⚠️  [IMAGE ERROR] ${imgErr.message}`);
        console.error(`Stack: ${imgErr.stack}`);
        console.error(`Falling back to text-only mode...\n`);
      }
    }

    // TEXT-ONLY CHAT PATH WITH MEMORYSTORE & DEBUG LOGGING
    const modelName = "gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    console.log(`\n📝 [TEXT CHAT MODE]`);
    console.log(`🤖 [MODEL] ${modelName}`);
    console.log(
      `🔗 [ENDPOINT] ${endpoint.replace(apiKey, "***API_KEY***")}`
    );

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
    console.log(
      `⏳ [API CALL] Sending request to Gemini API (text mode)...`
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.log(
      `📬 [API RESPONSE] Status: ${response.status} ${response.statusText}`
    );
    const data = await response.json();
    console.log(`📨 [RESPONSE BODY]`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error(`\n❌ [API ERROR] HTTP ${response.status} Response:`);
      console.error(JSON.stringify(data, null, 2));
      // DEBUGGING: Return actual error message
      const debugMsg = getFriendlyErrorMessage(data, true);
      return res.status(200).json({
        success: false,
        message: debugMsg,
        reply: debugMsg,
        debugError: data?.error || data,
      });
    }

    if (!data.candidates || data.candidates.length === 0) {
      console.error(`\n❌ [API ERROR] No candidates in response:`);
      console.error(JSON.stringify(data, null, 2));
      // DEBUGGING: Return actual error message
      const debugMsg = getFriendlyErrorMessage(data, true);
      return res.status(200).json({
        success: false,
        message: debugMsg,
        reply: debugMsg,
        debugError: "No candidates returned from API",
      });
    }

    const reply = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      console.error(`\n❌ [API ERROR] Empty text in candidate:`);
      console.error(JSON.stringify(data.candidates[0], null, 2));
      // DEBUGGING: Return actual error message
      const debugMsg = getFriendlyErrorMessage(
        { message: "No text content in response" },
        true
      );
      return res.status(200).json({
        success: false,
        message: debugMsg,
        reply: debugMsg,
        debugError: "No text content in candidate response",
      });
    }

    console.log(
      `✅ [CHAT] Success! Reply: "${reply.substring(0, 100)}..."`
    );

    // 3️⃣ SAVE AI RESPONSE TO MEMORYSTORE
    memoryStore.addAIMessage(
      sessionId,
      reply
    );

    res.json({
      success: true,
      reply,
      sessionId: sessionId,
      messagesCount: previousMessages.length + 2, // user + assistant
    });
  } catch (err) {
    // COMPREHENSIVE ERROR LOGGING
    console.error(`\n${"═".repeat(80)}`);
    console.error(`❌ [CHAT ENDPOINT ERROR]`);
    console.error(`${"═".repeat(80)}`);
    console.error(`Error Name: ${err.name}`);
    console.error(`Error Message: ${err.message}`);
    console.error(`Error Code: ${err.code}`);
    console.error(`Full Error Object:`, JSON.stringify(err, null, 2));
    console.error(`Stack Trace:`, err.stack);
    console.error(`${"═".repeat(80)}\n`);

    // DEBUGGING: Return actual error message
    const debugMsg = getFriendlyErrorMessage(err, true);
    res.status(200).json({
      success: false,
      message: debugMsg,
      reply: debugMsg,
      debugError: {
        name: err.name,
        message: err.message,
        code: err.code,
        stack: err.stack?.split("\n")[0],
      },
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
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({
      success: true,
      message: `Messages in session ${sessionId} cleared`,
    });
  } catch (err) {
    console.error(`❌ [API] Error clearing messages:`, err.message);
    res.status(500).json({
      error: "Failed to clear messages",
      message: err.message,
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
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({
      success: true,
      message: `Session ${sessionId} deleted`,
    });
  } catch (err) {
    console.error(`❌ [API] Error deleting session:`, err.message);
    res.status(500).json({
      error: "Failed to delete session",
      message: err.message,
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
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({
      success: true,
      session: sessionInfo,
    });
  } catch (err) {
    console.error(`❌ [API] Error fetching session info:`, err.message);
    res.status(500).json({
      error: "Failed to fetch session info",
      message: err.message,
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

    if (!messages) {
      return res.status(404).json({ error: "Session not found or no messages" });
    }

    res.json({
      success: true,
      sessionId,
      messageCount: messages.length,
      messages,
    });
  } catch (err) {
    console.error(`❌ [API] Error fetching messages:`, err.message);
    res.status(500).json({
      error: "Failed to fetch messages",
      message: err.message,
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
    console.error(`❌ [API] Error fetching stats:`, err.message);
    res.status(500).json({
      error: "Failed to get stats",
      message: err.message,
    });
  }
});
/* ═══════════════════════════════════════════════════════════════
   ANALYZE IMAGE
═══════════════════════════════════════════════════════════════ */
/*
app.post("/api/analyze-image", async (req, res) => {
  try {
    const { imageUrl, question } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

    const { base64, mimeType } = readImageFile(imageUrl);
    const analysisQuestion = question || "What do you see in this image? Describe it in detail.";

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent([
      { inlineData: { mimeType, data: base64 } },
      { text: analysisQuestion }
    ]);

    const analysis = response.response.text();
    console.log(`✅ [ANALYZE] Complete`);

    res.json({ success: true, imageUrl, question: analysisQuestion, analysis });
  } catch (err) {
    console.error(`❌ ANALYZE ERROR: ${err.message}`);
    res.status(500).json({ error: "Failed to analyze image", message: err.message });
  }
});
*/
// Removed the /api/analyze-image route as image analysis is now integrated into /api/chat
/* ═══════════════════════════════════════════════════════════════
   404 & ERROR HANDLING
═══════════════════════════════════════════════════════════════ */
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"), err => {
    if (err) res.status(404).json({ error: "Not Found", message: `Could not find ${req.path}` });
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not Found", message: `${req.method} ${req.path} does not exist` });
});

app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

/* ═══════════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 5173;

// Removed database initialization on startup
async function startServer() {
  app.listen(PORT, () => {
    console.log(`\n🚀 OXY AI running on port ${PORT}`);
    console.log(`   Local: http://localhost:${PORT}`);
    console.log(`   API:   http://localhost:${PORT}/api\n`);
  });
}

startServer().catch((err) => {
  console.error("❌ [STARTUP] Failed to start server:", err.message);
  process.exit(1);
});

