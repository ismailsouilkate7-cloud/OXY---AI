/**
 * MemoryStore with simple JSON persistence.
 * Persists sessions and profile memory to data/conversations.json
 */

import fs from 'fs';
import path from 'path';

const MAX_MESSAGES_PER_SESSION = 20; // Keep last 20 messages for context
const DATA_FILE = path.join(process.cwd(), 'data', 'conversations.json');

class MemoryStore {
  constructor() {
    this.data = {}; // Stores sessions. Each session has: { messages: [], profile: {}, createdAt, lastActive }
    this.pruningInterval = null;
    this._loadFromDisk();
    this.initPruning();
  }

  // ─── Session Management ──────────────────────────────────────────────────

  _createSession(sessionId) {
    if (!this.data[sessionId]) {
      this.data[sessionId] = {
        messages: [],
        profile: {},
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      };
      console.log(`🆕 MEMORY: Created session ${sessionId}`);
      this._saveToDisk();
    }
    this.data[sessionId].lastActive = new Date().toISOString();
    return this.data[sessionId];
  }

  deleteSession(sessionId) {
    if (this.data[sessionId]) {
      delete this.data[sessionId];
      console.log(`🗑️ MEMORY: Deleted session ${sessionId}`);
      this._saveToDisk();
      return true;
    }
    return false;
  }

  clearSessionMessages(sessionId) {
    if (this.data[sessionId]) {
      this.data[sessionId].messages = [];
      this.data[sessionId].lastActive = new Date().toISOString();
      console.log(`🧹 MEMORY: Cleared messages for session ${sessionId}`);
      this._saveToDisk();
      return true;
    }
    return false;
  }

  getSessionInfo(sessionId) {
    const session = this.data[sessionId];
    if (session) {
      return {
        sessionId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        lastActive: session.lastActive,
      };
    }
    return null;
  }

  // ─── Message Management ──────────────────────────────────────────────────

  _addMessage(sessionId, role, content) {
    const session = this._createSession(sessionId); // Ensure session exists
    session.messages.push({ role, content, timestamp: new Date().toISOString() });

    // Keep only the last N messages
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }
    session.lastActive = new Date().toISOString();
    this._saveToDisk();
  }

  addUserMessage(sessionId, content) {
    this._addMessage(sessionId, 'user', content);
  }

  addAIMessage(sessionId, content) {
    this._addMessage(sessionId, 'model', content);
  }

  getLastMessages(sessionId, count = 10) {
    const session = this.data[sessionId];
    if (!session) return [];
    return session.messages.slice(-count);
  }

  // ─── Profile Memory ──────────────────────────────────────────────────

  getProfile(sessionId) {
    const session = this._createSession(sessionId);
    return session.profile || {};
  }

  updateProfile(sessionId, updates = {}) {
    const session = this._createSession(sessionId);
    session.profile = Object.assign({}, session.profile || {}, updates);
    session.lastActive = new Date().toISOString();
    console.log(`🔧 MEMORY: Updated profile for ${sessionId}:`, updates);
    this._saveToDisk();
    return session.profile;
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  _loadFromDisk() {
    try {
      if (!fs.existsSync(DATA_FILE)) {
        // ensure data directory exists
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify({}), 'utf8');
      }
      const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
      const parsed = JSON.parse(raw || '{}');
      this.data = parsed;
      console.log(`💾 MEMORY: Loaded ${Object.keys(this.data).length} sessions from disk`);
    } catch (err) {
      console.error('❌ MEMORY: Failed to load from disk', err.message);
      this.data = {};
    }
  }

  _saveToDisk() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      // console.log(`💾 MEMORY: Saved ${Object.keys(this.data).length} sessions to disk`);
    } catch (err) {
      console.error('❌ MEMORY: Failed to save to disk', err.message);
    }
  }

  // Convenience API methods required by requirements
  saveMemory(sessionId) {
    this._saveToDisk();
  }

  loadMemory(sessionId) {
    this._loadFromDisk();
    return this.getLastMessages(sessionId, MAX_MESSAGES_PER_SESSION);
  }

  updateProfileMemory(sessionId, updates = {}) {
    return this.updateProfile(sessionId, updates);
  }

  clearMemory(sessionId) {
    return this.clearSessionMessages(sessionId);
  }

  // ─── Pruning (cleanup of old sessions) ───────────────────────────────────

  initPruning() {
    // Prune sessions older than 24 hours every hour
    this.pruningInterval = setInterval(() => {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      let prunedCount = 0;

      for (const sessionId in this.data) {
        if (this.data[sessionId].lastActive < twentyFourHoursAgo) {
          delete this.data[sessionId];
          prunedCount++;
        }
      }

      if (prunedCount > 0) {
        console.log(`✂️ MEMORY: Pruned ${prunedCount} old sessions`);
      }
    }, 60 * 60 * 1000); // Every 1 hour
  }

  stopPruning() {
    if (this.pruningInterval) {
      clearInterval(this.pruningInterval);
      this.pruningInterval = null;
      console.log("🛑 MEMORY: Stopped pruning old sessions.");
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats() {
    const totalSessions = Object.keys(this.data).length;
    let totalMessages = 0;
    for (const sessionId in this.data) {
      totalMessages += this.data[sessionId].messages.length;
    }
    return {
      totalSessions,
      totalMessages,
      MAX_MESSAGES_PER_SESSION,
    };
  }
}

const memoryStore = new MemoryStore();
export default memoryStore;
