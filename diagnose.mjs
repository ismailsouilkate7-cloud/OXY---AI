import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

console.log("\n" + "=".repeat(70));
console.log("🔍 OXY AI — Gemini API Diagnostics");
console.log("=".repeat(70));
console.log(`🔑 API Key present: ${apiKey ? "✅ YES" : "❌ MISSING"}`);
if (apiKey) {
  console.log(`   Length  : ${apiKey.length} chars`);
  console.log(`   Prefix  : ${apiKey.substring(0, 8)}...`);
}
console.log("=".repeat(70) + "\n");

if (!apiKey) {
  console.error("❌ FATAL: GEMINI_API_KEY is not set in .env — stopping.");
  process.exit(1);
}

// ── Models to test ───────────────────────────────────────────────────────────
const MODELS = [
  "gemini-2.5-flash",                  // current PRIMARY
  "gemini-2.0-flash",                  // current FALLBACK
  "gemini-1.5-flash",                  // known-good baseline
  "gemini-2.5-flash-preview-05-20",    // preview variant
];

// ── Correct payload (role on every content item!) ───────────────────────────
const GOOD_BODY = {
  system_instruction: { parts: [{ text: "You are a helpful assistant." }] },
  contents: [
    { role: "user", parts: [{ text: "Say hello in one word." }] }
  ],
};

// ── Broken payload (missing role — mirrors the current bug in server.js) ─────
const BAD_BODY = {
  system_instruction: { parts: [{ text: "You are a helpful assistant." }] },
  contents: [
    { parts: [{ text: "Say hello in one word." }] }   // ← no role!
  ],
};

async function testModel(modelName, body, label) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  console.log(`\n${"─".repeat(70)}`);
  console.log(`🤖 Model  : ${modelName}`);
  console.log(`📋 Payload: ${label}`);
  console.log(`🔗 URL    : ${url.replace(apiKey, "***KEY***")}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch {}

    console.log(`📬 HTTP Status : ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const errMsg = parsed?.error?.message || rawText.substring(0, 400);
      const errCode = parsed?.error?.code || res.status;
      const errStatus = parsed?.error?.status || "UNKNOWN";
      console.error(`❌ FAILED`);
      console.error(`   Error Code   : ${errCode}`);
      console.error(`   Error Status : ${errStatus}`);
      console.error(`   Error Message: ${errMsg}`);
      if (parsed?.error?.details) {
        console.error(`   Details      :`, JSON.stringify(parsed.error.details, null, 2));
      }
    } else {
      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`✅ SUCCESS — reply: "${text.substring(0, 100)}"`);
      } else {
        console.warn(`⚠️  OK HTTP but empty candidates. Full response:`);
        console.warn(JSON.stringify(parsed, null, 2));
      }
    }
  } catch (err) {
    console.error(`💥 NETWORK/FETCH ERROR: ${err.message}`);
  }
}

// 1. Test each model with the BROKEN payload (mirrors current server.js bug)
console.log("\n\n" + "█".repeat(70));
console.log("TEST 1 — Current server.js payload (BUG: missing role on last content)");
console.log("█".repeat(70));
for (const model of MODELS) {
  await testModel(model, BAD_BODY, "❌ BROKEN (no role)");
}

// 2. Test each model with the CORRECT payload
console.log("\n\n" + "█".repeat(70));
console.log("TEST 2 — Fixed payload (role: 'user' on every content item)");
console.log("█".repeat(70));
for (const model of MODELS) {
  await testModel(model, GOOD_BODY, "✅ CORRECT (role present)");
}

console.log("\n\n" + "=".repeat(70));
console.log("✅ Diagnostics complete");
console.log("=".repeat(70) + "\n");
