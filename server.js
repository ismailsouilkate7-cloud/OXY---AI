import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import rateLimit from "express-rate-limit";
import memoryStore from "./memoryStore.js";

dotenv.config();

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are OXY AI.

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

// ─── Directories ───────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
// const generatedDir = path.join(__dirname, "uploads", "generated"); // Removed image generation directory

[uploadsDir].forEach(dir => { // Removed generatedDir from this loop
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// ─── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `image_${timestamp}_${randomStr}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PNG, JPG, JPEG, WEBP`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ─── Middleware ────────────────────────────────────────────────────────────────
// IMPORTANT: Trust proxy BEFORE rate limiting middleware
// This tells Express to trust X-Forwarded-For header from Vercel
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

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
  keyGenerator: (req, res) => req.ip || req.connection.remoteAddress,
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

// ─── FIXED ERROR HANDLER ─────────────────────────────────────────────────────
function getFriendlyErrorMessage(error) {
  const errorStr =
    typeof error === "string"
      ? error
      : (error?.message || error?.error?.message || JSON.stringify(error || ""));

  const lower = errorStr.toLowerCase();

  const statusCode = error?.status || error?.statusCode;

  console.error("❌ Gemini/API Error:", errorStr);

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

// ─── Helper: read image file ───────────────────────────────────────────────────
function readImageFile(imageUrl) {
  if (!imageUrl.startsWith('/uploads/')) {
    throw new Error('Invalid image URL format');
  }
  const localPath = path.join(__dirname, imageUrl);
  if (!fs.existsSync(localPath)) {
    throw new Error(`Image file not found: ${localPath}`);
  }
  const fileBuffer = fs.readFileSync(localPath);
  const base64 = fileBuffer.toString('base64');
  const ext = path.extname(localPath).toLowerCase();
  let mimeType = 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
  else if (ext === '.webp') mimeType = 'image/webp';
  return { base64, mimeType, localPath, originalBuffer: fileBuffer };
}



/* ═══════════════════════════════════════════════════════════════
   IMAGE UPLOAD
═══════════════════════════════════════════════════════════════ */
app.post("/api/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided", message: "Please select an image to upload" });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const fileSize = (req.file.size / 1024 / 1024).toFixed(2);

    console.log(`✅ [UPLOAD] ${req.file.originalname} → ${req.file.filename} (${fileSize}MB)`);

    res.json({
      success: true,
      message: "Image uploaded successfully",
      imageUrl,
      fileName: req.file.originalname,
      fileSize
    });
  } catch (err) {
    console.error(`❌ UPLOAD ERROR: ${err.message}`);
    res.status(500).json({ error: "Upload failed", message: err.message });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: "File too large", message: "Maximum file size is 50MB" });
    }
    return res.status(400).json({ error: "Upload error", message: err.message });
  } else if (err && err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: "Invalid file type", message: err.message });
  }
  next(err);
});

/* ═══════════════════════════════════════════════════════════════
   CHAT API — WITH PERSISTENT MEMORY
═══════════════════════════════════════════════════════════════ */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, imageUrl, sessionId } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    // Generate sessionId if not provided (for persistent user sessions)
    const session = sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log(`\n📨 [CHAT] Session: ${session} | Message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"${imageUrl ? ` | Image: ${imageUrl}` : ''}`);

    // 1️⃣ LOAD PREVIOUS MESSAGES FROM MEMORY
    const previousMessages = memoryStore.getLastMessages(session, 10);
    console.log(`📚 [MEMORY] Loaded ${previousMessages.length} previous messages for context`);

    // 2️⃣ ADD CURRENT USER MESSAGE TO MEMORY
    memoryStore.addUserMessage(session, message);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server Error", message: "GEMINI_API_KEY is not configured" });
    }

    // Handle image if provided
    if (imageUrl) {
      try {
        const { base64, mimeType } = readImageFile(imageUrl);
        
        // Build content array with memory context + current message + image
        const contentParts = [];
        
        // Add system prompt
        contentParts.push({ text: SYSTEM_PROMPT });
        
        // Add conversation history for context
        if (previousMessages.length > 0) {
          const historyText = previousMessages
            .map(msg => `${msg.role === 'user' ? '👤 User' : '🤖 Assistant'}: ${msg.content}`)
            .join('\n\n');
          contentParts.push({ text: `\n\nPrevious conversation:\n${historyText}\n\nCurrent user message:` });
        }
        
        // Add current message and image
        contentParts.push({ text: message });
        contentParts.push({ inlineData: { mimeType, data: base64 } });
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(contentParts);
        const reply = result.response.text();
        
        console.log(`✅ [CHAT+IMAGE] Reply: "${reply.substring(0, 100)}..."`);
        
        // 3️⃣ SAVE AI RESPONSE TO MEMORY
        memoryStore.addAIMessage(session, reply);
        
        return res.json({ 
          reply, 
          sessionId: session,
          messagesCount: previousMessages.length + 2 // user + assistant
        });
      } catch (imgErr) {
        console.error(`⚠️ Image chat error: ${imgErr.message} — falling back to text`);
      }
    }

    // TEXT-ONLY CHAT PATH WITH MEMORY
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Build request with conversation history
    const contents = [];
    
    // Add previous messages as context
    for (const msg of previousMessages) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }
    
    // Add current user message
    contents.push({ parts: [{ text: message }] });
    
    const requestBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents
    };

    console.log(`📡 [API] Sending ${contents.length} content(s) to Gemini (${previousMessages.length} from memory)`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      const friendlyMsg = getFriendlyErrorMessage(data);
      console.error(`❌ Gemini API responded with ${response.status}:`, data?.error?.message || data);
      return res.status(200).json({ 
        success: false, 
        message: friendlyMsg,
        reply: friendlyMsg
      });
    }

    if (!data.candidates || data.candidates.length === 0) {
      const friendlyMsg = getFriendlyErrorMessage(data);
      console.error(`❌ Gemini API returned no candidates:`, data);
      return res.status(200).json({ 
        success: false, 
        message: friendlyMsg,
        reply: friendlyMsg
      });
    }

    const reply = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      const friendlyMsg = "🤖 L'AI khaso yerta7 chwia. 3awed jarrab ba3d da9i9a.";
      console.error(`❌ Gemini API returned empty text in candidate:`, data.candidates[0]);
      return res.status(200).json({ 
        success: false, 
        message: friendlyMsg,
        reply: friendlyMsg
      });
    }

    console.log(`✅ [CHAT] Reply: "${reply.substring(0, 100)}..."`);
    
    // 3️⃣ SAVE AI RESPONSE TO MEMORY
    memoryStore.addAIMessage(session, reply);
    
    res.json({ 
      success: true,
      reply, 
      sessionId: session,
      messagesCount: previousMessages.length + 2 // user + assistant
    });

  } catch (err) {
    const friendlyMsg = getFriendlyErrorMessage(err);
    console.error(`❌ CHAT ERROR:`, err.message);
    res.status(200).json({ 
      success: false, 
      message: friendlyMsg,
      reply: friendlyMsg
    });
  }
});

/* ═══════════════════════════════════════════════════════════════
   MEMORY MANAGEMENT API
═══════════════════════════════════════════════════════════════ */

/**
 * GET /api/memory/session/:sessionId
 * Retrieve all messages in a session
 */
app.get("/api/memory/session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = memoryStore.getSessionInfo(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    const fullSession = memoryStore.data[sessionId];
    res.json({
      success: true,
      ...session,
      messages: fullSession.messages
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve session", message: err.message });
  }
});

/**
 * GET /api/memory/history/:sessionId
 * Get last N messages from a session (shorter endpoint)
 */
app.get("/api/memory/history/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const count = parseInt(req.query.count) || 10;
    
    const messages = memoryStore.getLastMessages(sessionId, count);
    
    res.json({
      success: true,
      sessionId,
      messageCount: messages.length,
      messages
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve history", message: err.message });
  }
});

/**
 * DELETE /api/memory/session/:sessionId
 * Delete a session and all its messages
 */
app.delete("/api/memory/session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    memoryStore.deleteSession(sessionId);
    
    res.json({
      success: true,
      message: `Session ${sessionId} deleted`
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete session", message: err.message });
  }
});

/**
 * POST /api/memory/clear/:sessionId
 * Clear all messages in a session (keep session metadata)
 */
app.post("/api/memory/clear/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    memoryStore.clearSessionMessages(sessionId);
    
    res.json({
      success: true,
      message: `Messages in session ${sessionId} cleared`
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear session", message: err.message });
  }
});

/**
 * GET /api/memory/stats
 * Get memory system statistics
 */
app.get("/api/memory/stats", (req, res) => {
  try {
    const stats = memoryStore.getStats();
    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get stats", message: err.message });
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
app.listen(PORT, () => {
  console.log(`\n🚀 OXY AI running on port ${PORT}`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api\n`);
});
