// ==================== 
// MARKDOWN RENDERER
// ==================== 

function parseAndRenderMarkdown(text) {
  if (!text) return '';
  
  // Step 1: Extract and preserve code blocks first (so their content isn't corrupted by other transforms)
  const codeBlocks = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let codeBlockId = 0;
  let processed = text.replace(codeBlockRegex, (match, language, code) => {
    const id = `__CODE_BLOCK_${codeBlockId}__`;
    codeBlocks.push({
      id,
      language: language || 'code',
      code: code.trim()
    });
    codeBlockId++;
    return id;
  });

  // Step 2: Escape HTML entities in the remaining text (between code blocks)
  processed = processed
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');

  // Step 4: Render block-level markdown elements (in order)

  // Horizontal rules (must be before headings since they use ## differently)
  processed = processed.replace(/^---\s*$/gm, '<hr>');

  // Headings (## then #)
  processed = processed.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  processed = processed.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  processed = processed.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  processed = processed.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  processed = processed.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Tables: find table blocks and convert to HTML
  processed = processed.replace(/(?:^\|(.+)\|\s*\n)+/gm, (tableMatch) => {
    const rows = tableMatch.trim().split('\n');
    if (rows.length < 1) return tableMatch;
    
    const headers = rows[0].split('|').filter(cell => cell.trim() !== '').map(cell => cell.trim());
    // Skip the separator row (---|---|---)
    const dataRows = rows.slice(2).filter(row => row.trim() !== '');
    
    let html = '<table>\n<thead>\n<tr>\n';
    headers.forEach(h => { html += `<th>${h}</th>\n`; });
    html += '</tr>\n</thead>\n<tbody>\n';
    dataRows.forEach(row => {
      const cells = row.split('|').filter(cell => cell.trim() !== '').map(cell => cell.trim());
      html += '<tr>\n';
      cells.forEach(cell => { html += `<td>${cell}</td>\n`; });
      html += '</tr>\n';
    });
    html += '</tbody>\n</table>';
    return html;
  });

  // Step 5: Convert line breaks to <br> for non-block elements
  // But preserve block-level HTML elements
  processed = processed.replace(/\n/g, '<br>');

  // Step 6: Render inline markdown elements (order matters - bold before italic)

  // Inline code (must be before bold/italic to avoid conflicts)
  processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold + italic
  processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  
  // Bold
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Strikethrough
  processed = processed.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Step 7: Restore code blocks
  codeBlocks.forEach(block => {
    const codeHTML = `
      <div class="code-block">
        <div class="code-header">
          <span class="code-language">${escapeHtml(block.language)}</span>
          <button class="copy-btn" data-code-id="${block.id}" title="Copy code">
            <span class="copy-text">📋 Copy</span>
          </button>
        </div>
        <pre><code class="language-${escapeHtml(block.language)}" id="${block.id}">${escapeHtml(block.code)}</code></pre>
      </div>`;
    processed = processed.replace(block.id, codeHTML);
  });

  // Step 8: Collapse consecutive <br> tags between block elements for cleaner spacing
  // (happens naturally from blank lines in markdown)
  processed = processed.replace(/(<\/h[1-4]>)\s*<br>\s*/g, '$1\n');
  processed = processed.replace(/(<\/blockquote>)\s*<br>\s*/g, '$1\n');
  processed = processed.replace(/(<\/table>)\s*<br>\s*/g, '$1\n');
  processed = processed.replace(/<br>\s*<(h[1-4]|blockquote|table|hr|ul|ol)/g, '<$1');
  processed = processed.replace(/<(h[1-4]|blockquote|table|hr|ul|ol).*?>\s*<br>\s*/g, (match) => match.replace(/<br>\s*$/, ''));

  return processed;
}

function attachCodeBlockListeners() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', copyCode);
  });
}

function copyCode(e) {
  const btn = e.currentTarget;
  const codeId = btn.getAttribute('data-code-id');
  const codeElement = document.getElementById(codeId);
  if (!codeElement) return;
  const code = codeElement.textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.innerHTML = '<span class="copy-text">✅ Copied!</span>';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<span class="copy-text">📋 Copy</span>';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    btn.innerHTML = '<span class="copy-text">❌ Failed</span>';
    setTimeout(() => {
      btn.innerHTML = '<span class="copy-text">📋 Copy</span>';
    }, 2000);
  });
}

// ─── HTML entity encoding ──────────────────────────────────────
function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;')
    .replace(/'/g, '&' + '#39;');
}

// ==================== 
// IMAGE MODAL (full-size preview)
// ==================== 

let currentModalSrc = '';

function openImageModal(src) {
  currentModalSrc = src;
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImage');
  img.src = src;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  const modal = document.getElementById('imageModal');
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ==================== 
// CONVERSATION HISTORY SYSTEM
// ==================== 

const STORAGE_KEY = 'oxy_conversations';
const ACTIVE_CONV_KEY = 'oxy_active_conversation';

let conversations = [];        // Array of conversation objects
let activeConversationId = null; // ID of the currently active conversation
let currentConversation = null; // The active conversation object (convenience ref)

// Load conversations from localStorage
function loadConversations() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      conversations = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load conversations:', e);
    conversations = [];
  }
  
  // Load active conversation ID
  try {
    const activeId = localStorage.getItem(ACTIVE_CONV_KEY);
    if (activeId) {
      activeConversationId = activeId;
      currentConversation = conversations.find(c => c.id === activeId) || null;
    }
  } catch (e) {
    console.warn('Failed to load active conversation:', e);
  }
  
  // If no active conversation and we have conversations, use the most recent
  if (!currentConversation && conversations.length > 0) {
    // Sort by updatedAt descending
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    currentConversation = conversations[0];
    activeConversationId = currentConversation.id;
    saveActiveConversationId();
  }
}

// Save conversations to localStorage
function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (e) {
    console.warn('Failed to save conversations:', e);
  }
}

// Save active conversation ID
function saveActiveConversationId() {
  try {
    if (activeConversationId) {
      localStorage.setItem(ACTIVE_CONV_KEY, activeConversationId);
    } else {
      localStorage.removeItem(ACTIVE_CONV_KEY);
    }
  } catch (e) {
    console.warn('Failed to save active conversation ID:', e);
  }
}

// Generate a unique conversation ID
function generateConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Generate title from first user message
// Creates a short, meaningful summary (like ChatGPT) instead of using the raw message
function generateTitle(text) {
  if (!text || !text.trim()) return 'New Chat';
  
  // Step 1: Normalize — lower case, trim
  let normalized = text.trim().toLowerCase();
  
  // Step 2: Remove common greetings / filler / action verbs / question words
  // These are words that don't help identify the topic
  const noiseWords = /\b(hi|hello|hey|salam|slm|slt|assalamu|alaykum|wa|alaikum|marhaba|ahlan|bien|bonjour|salut|good|morning|afternoon|evening|please|pls|can|could|would|will|may|should|might|must|the|a|an|is|are|was|were|been|being|do|does|did|done|doing|how|what|why|when|where|which|who|whom|whose|this|that|these|those|i|my|me|we|our|us|you|your|yours|he|she|it|they|them|their|create|make|write|build|show|tell|give|need|want|have|has|had|having|with|for|to|of|in|on|at|by|from|as|be|not|no|or|and|but|if|so|than|that|just|about|up|out|off|over|also|very|really|like|get|got|use|used|using|into|onto|upon|some|any|all|every|each|both|few|more|most|much|many|such|only|own|same|too|well|now|then|here|there|please|tell|explain|describe|define|list|give|help|assist)\b/gi;
  normalized = normalized.replace(noiseWords, ' ').trim();
  
  // Step 3: Remove special characters (keep letters, numbers, spaces, dots and hyphens for things like "node.js")
  normalized = normalized.replace(/[^a-zA-Z0-9\s.\-]/g, ' ').trim();
  
  // Step 4: Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Step 5: Split into words, filter out short/meaningless ones
  let words = normalized.split(/\s+/).filter(w => w.length >= 2);
  
  // Step 6: If no words remain after filtering, try extracting key content words from original
  if (words.length === 0) {
    // Extract words that look like meaningful content (4+ chars, not filler)
    const contentPattern = /\b([a-zA-Z]{4,})\b/g;
    let match;
    const contentWords = [];
    while ((match = contentPattern.exec(text.toLowerCase())) !== null) {
      const word = match[1];
      if (!/^(this|that|with|from|have|what|when|where|which|about|could|would|should|their|there|these|those|being|doing|having|going|coming|making|using|getting|telling|giving|taking|knowing|saying|seeing|thinking|working|playing|running|moving|looking|finding|keeping|putting|setting|starting|trying|asking|needing|wanting|calling|showing|turning|bringing|buying|costing|cutting|doing|drawing|falling|feeling|finding|flying|forgetting|giving|going|growing|hanging|having|hearing|hiding|hitting|holding|hoping|keeping|knowing|laying|leading|learning|leaving|lending|letting|lifting|listening|living|losing|making|meaning|meeting|mistaking|moving|needing|noticing|opening|ordering|passing|paying|playing|pointing|pulling|pushing|putting|reading|riding|ringing|rising|running|saying|seeing|selling|sending|setting|shaking|shining|shooting|showing|singing|sinking|sitting|sleeping|sliding|smelling|speaking|spending|standing|starting|staying|stealing|sticking|striking|studying|swimming|taking|talking|teaching|telling|thinking|throwing|touching|trying|understanding|using|visiting|waiting|walking|wanting|warning|wearing|winning|wishing|wondering|working|writing)$/i.test(word)) {
        contentWords.push(word);
      }
    }
    if (contentWords.length > 0) {
      words = contentWords;
    }
  }
  
  // Step 7: Take max 3 words for a short title
  if (words.length > 3) {
    words = words.slice(0, 3);
  }
  
  // Step 8: Build title in Title Case
  let title = words.map(word => {
    // Handle words with dots (e.g., "node.js" → "Node.js")
    if (word.includes('.')) {
      return word.split('.').map((part, i) => 
        i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part
      ).join('.');
    }
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
  
  // Step 9: Max 30 characters
  if (title.length > 30) {
    title = title.substring(0, 27) + '...';
  }
  
  // Step 10: If still empty or too short, fall back
  if (title.length < 3) {
    title = 'New Chat';
  }
  
  return title;
}

// Format date for display
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  // Return formatted date
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString('en-US', options);
}

// Create a new conversation
function createNewConversation() {
  const now = new Date().toISOString();
  const id = generateConversationId();
  const conversation = {
    id,
    title: 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  
  conversations.unshift(conversation);
  activeConversationId = id;
  currentConversation = conversation;
  
  saveConversations();
  saveActiveConversationId();
  renderConversationList();
  updateChatTitle();
  
  return conversation;
}

// Switch to a conversation
function switchToConversation(conversationId) {
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return;
  
  // Cancel any editing state
  if (editingMessageId) {
    cancelEditMessage();
  }
  
  activeConversationId = conversationId;
  currentConversation = conversation;
  saveActiveConversationId();
  
  // Restore messages
  messages = JSON.parse(JSON.stringify(conversation.messages)); // Deep clone
  
  // Clear chat UI
  const messageElements = chatContainer.querySelectorAll('.message-row');
  messageElements.forEach(m => m.remove());
  
  // Show welcome screen if no messages
  if (messages.length === 0) {
    welcomeScreen.style.display = 'flex';
  } else {
    welcomeScreen.style.display = 'none';
    // Re-render all messages
    messages.forEach(msg => {
      const el = renderMessage(msg);
      chatContainer.appendChild(el);
    });
    scrollToBottom();
    attachCodeBlockListeners();
    attachImageClickListeners();
  }
  
  // Update sidebar
  renderConversationList();
  updateChatTitle();
  
  // Regenerate session ID for proper API continuity
  sessionId = `session_${conversationId}_${Date.now()}`;
  localStorage.setItem('oxy_session_id', sessionId);
}

// Update the current conversation's title from first user message
function updateConversationTitle(title) {
  if (!currentConversation) return;
  
  currentConversation.title = title;
  currentConversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
  updateChatTitle();
}

// Save current messages to the active conversation
function saveMessagesToConversation() {
  if (!currentConversation) return;
  
  currentConversation.messages = JSON.parse(JSON.stringify(messages)); // Deep clone
  currentConversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
}

// Rename a conversation
function renameConversation(conversationId, newTitle) {
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return;
  
  conversation.title = newTitle.trim() || 'New Chat';
  conversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
  
  if (activeConversationId === conversationId) {
    updateChatTitle();
  }
}

// Delete a conversation
function deleteConversation(conversationId) {
  const index = conversations.findIndex(c => c.id === conversationId);
  if (index === -1) return;
  
  conversations.splice(index, 1);
  saveConversations();
  
  // If we deleted the active conversation, switch to another or create new
  if (activeConversationId === conversationId) {
    if (conversations.length > 0) {
      switchToConversation(conversations[0].id);
    } else {
      // Clear everything
      activeConversationId = null;
      currentConversation = null;
      messages = [];
      localStorage.removeItem(ACTIVE_CONV_KEY);
      
      const messageElements = chatContainer.querySelectorAll('.message-row');
      messageElements.forEach(m => m.remove());
      welcomeScreen.style.display = 'flex';
      chatTitle.textContent = 'OXY AI';
      
      renderConversationList();
      
      // Generate new session
      sessionId = generateSessionId();
    }
  } else {
    renderConversationList();
  }
}

// Update chat title in header
function updateChatTitle() {
  const chatTitle = document.getElementById('chatTitle');
  if (currentConversation && messages.length > 0) {
    chatTitle.textContent = currentConversation.title;
  } else {
    chatTitle.textContent = 'OXY AI';
  }
}

// Render the conversation list in sidebar
function renderConversationList() {
  const list = document.getElementById('conversationList');
  if (!list) return;
  
  // Sort by updatedAt descending (newest first)
  const sorted = [...conversations].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  
  if (sorted.length === 0) {
    list.innerHTML = '<div class="conversation-empty">No conversations yet</div>';
    return;
  }
  
  list.innerHTML = '';
  
  sorted.forEach(conv => {
    const item = document.createElement('div');
    item.className = `conversation-item${conv.id === activeConversationId ? ' active' : ''}`;
    item.dataset.conversationId = conv.id;
    
    item.innerHTML = `
      <div class="conversation-item-content">
        <div class="conversation-item-title">${escapeHtml(conv.title)}</div>
        <div class="conversation-item-date">${formatDate(conv.updatedAt)}</div>
      </div>
      <div class="conversation-item-actions">
        <button class="conversation-item-actions-btn" data-action="menu" title="More actions">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
    `;
    
    // Click on content area to switch conversation
    item.querySelector('.conversation-item-content').addEventListener('click', (e) => {
      e.stopPropagation();
      if (conv.id !== activeConversationId) {
        switchToConversation(conv.id);
      }
    });
    
    // Click on context menu button
    item.querySelector('[data-action="menu"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      showContextMenu(conv.id, rect.left - 140, rect.bottom + 4);
    });
    
    list.appendChild(item);
  });
}

// ─── Context Menu ──────────────────────────────────────────────
let contextMenuTargetId = null;

function showContextMenu(conversationId, x, y) {
  const menu = document.getElementById('conversationContextMenu');
  contextMenuTargetId = conversationId;
  
  // Position the menu
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 170)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 100)) + 'px';
  menu.style.display = 'block';
  
  // Close menu on outside click
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

function closeContextMenu() {
  const menu = document.getElementById('conversationContextMenu');
  menu.style.display = 'none';
  contextMenuTargetId = null;
}

// ─── Initialize conversation system ────────────────────────────
function initConversationSystem() {
  loadConversations();
  
  // If we have an active conversation, restore it
  if (currentConversation) {
    // Restore messages from active conversation
    messages = JSON.parse(JSON.stringify(currentConversation.messages));
    
    if (messages.length > 0) {
      welcomeScreen.style.display = 'none';
      messages.forEach(msg => {
        const el = renderMessage(msg);
        chatContainer.appendChild(el);
      });
      scrollToBottom();
      attachCodeBlockListeners();
      attachImageClickListeners();
    }
    updateChatTitle();
    
    // Restore session from conversation
    sessionId = `session_${currentConversation.id}_${Date.now()}`;
    localStorage.setItem('oxy_session_id', sessionId);
  } else {
    // Create first conversation
    createNewConversation();
  }
  
  renderConversationList();
}


// ==================== 
// IMAGE UPLOAD & CHAT SYSTEM  
// ==================== 

let sessionId = localStorage.getItem('oxy_session_id') || generateSessionId();
let selectedFile = null;
let uploadedImageUrl = null;
let isRequesting = false; // Request lock — prevents double submissions
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds min between requests

let messages = []; // Array to store messages
let editingMessageId = null; // To store the ID of the message being edited

function generateSessionId() {
  const id = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  localStorage.setItem('oxy_session_id', id);
  console.log(`💾 [MEMORY] Created new sessionId: ${id}`);
  return id;
}

// ─── Request lock helper ───────────────────────────────────────
function canSendRequest() {
  if (isRequesting) return false;
  const now = Date.now();
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL) return false;
  return true;
}

function lockRequest() {
  isRequesting = true;
  lastRequestTime = Date.now();
  sendBtn.disabled = true;
  sendBtn.style.cursor = 'wait';
  msgInput.disabled = true;
  attachBtn.disabled = true;
  editControls.style.display = 'none'; // Hide edit controls when sending/editing
}

function unlockRequest() {
  isRequesting = false;
  msgInput.disabled = false;
  updateSendButton();
  attachBtn.disabled = false;
  if (editingMessageId) {
    editControls.style.display = 'flex'; // Show edit controls if still editing
  }
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// DOM refs
const chatContainer = document.getElementById('chat');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const inputImagePreview = document.getElementById('inputImagePreview');
const previewThumb = document.getElementById('previewThumb');
const previewFileName = document.getElementById('previewFileName');
const previewFileSize = document.getElementById('previewFileSize');
const previewRemoveBtn = document.getElementById('previewRemoveBtn');
const welcomeScreen = document.getElementById('welcomeScreen');
const dragOverlay = document.getElementById('dragOverlay');
const inputArea = document.getElementById('inputArea');
const editControls = document.getElementById('editControls');
const saveEditBtn = document.getElementById('saveEditBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const chatTitle = document.getElementById('chatTitle');

// ─── Auto-resize textarea ─────────────────────────────────────
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
  updateSendButton();
});

function updateSendButton() {
  const hasText = msgInput.value.trim().length > 0;
  const hasImage = uploadedImageUrl !== null;
  const enabled = hasText || hasImage;
  sendBtn.disabled = !enabled;
  sendBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
  if (enabled) {
    sendBtn.style.background = 'var(--text-primary)';
  } else {
    sendBtn.style.background = 'var(--text-disabled)';
  }
}

// ─── Attach button click ──────────────────────────────────────
attachBtn.addEventListener('click', () => fileInput.click());

// ─── File input change ────────────────────────────────────────
fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

// ─── Drag and drop (on whole input area) ──────────────────────
let dragCounter = 0;

inputArea.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter++;
  dragOverlay.classList.add('active');
});

inputArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

inputArea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dragOverlay.classList.remove('active');
  }
});

inputArea.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  dragOverlay.classList.remove('active');
  if (e.dataTransfer.files.length > 0) {
    handleFiles(e.dataTransfer.files);
  }
});

// ─── Remove preview ───────────────────────────────────────────
previewRemoveBtn.addEventListener('click', removeSelectedImage);

function removeSelectedImage() {
  selectedFile = null;
  uploadedImageUrl = null;
  inputImagePreview.style.display = 'none';
  attachBtn.classList.remove('has-image');
  updateSendButton();
}

// ─── Handle files ─────────────────────────────────────────────
function handleFiles(files) {
  if (files.length === 0) return;
  const file = files[0];

  if (!ALLOWED_TYPES.includes(file.type)) {
    showToast('❌ Invalid file type. Allowed: PNG, JPG, JPEG, WEBP', 'error');
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showToast(`❌ File too large. Max: 50MB. Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`, 'error');
    return;
  }

  selectedFile = file;
  uploadImage();
}

// ─── Upload image ─────────────────────────────────────────────
async function uploadImage() {
  if (!selectedFile) return;

  attachBtn.disabled = true;
  showUploadProgress(true);

  try {
    const formData = new FormData();
    formData.append('image', selectedFile);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok || !data.success || !data.imageUrl) {
      throw new Error(data.message || 'Upload failed');
    }

    uploadedImageUrl = data.imageUrl;
    displayPreview();
    updateSendButton();
    showToast('✅ Image uploaded', 'success');

  } catch (err) {
    showToast(`❌ Upload failed: ${err.message}`, 'error');
    selectedFile = null;
    uploadedImageUrl = null;
  } finally {
    attachBtn.disabled = false;
    showUploadProgress(false);
  }
}

// ─── Display preview ──────────────────────────────────────────
function displayPreview() {
  if (!selectedFile || !uploadedImageUrl) return;
  previewThumb.src = uploadedImageUrl;
  previewFileName.textContent = selectedFile.name;
  previewFileSize.textContent = (selectedFile.size / 1024 / 1024).toFixed(2) + ' MB';
  inputImagePreview.style.display = 'flex';
  attachBtn.classList.add('has-image');
}

// ─── Upload progress indicator ────────────────────────────────
function showUploadProgress(show) {
  const existing = document.querySelector('.upload-progress');
  if (existing) existing.remove();
  if (!show) return;

  const div = document.createElement('div');
  div.className = 'upload-progress';
  div.innerHTML = `
    <span>⏳ Uploading...</span>
    <div class="upload-progress-bar">
      <div class="upload-progress-fill" style="width:60%"></div>
    </div>`;
  inputArea.insertBefore(div, inputImagePreview.nextSibling || inputArea.firstChild);
}

// ==================== 
// SEND MESSAGE
// ==================== 

async function sendMessage() {
  // Request lock — prevent double submissions
  if (!canSendRequest()) {
    showToast('⏳ Please wait, a request is already in progress.', 'info');
    return;
  }

  const text = msgInput.value.trim();
  const hasImage = uploadedImageUrl !== null;

  if (!text && !hasImage) return;

  lockRequest();

  // Hide welcome screen
  welcomeScreen.style.display = 'none';

  const currentImageUrl = uploadedImageUrl;
  const currentText = text;

  let conversationHistory = [...messages]; // Copy current messages for potential modification

  let isFirstMessage = messages.length === 0;

  if (editingMessageId) {
    // 1. Update the message in our local state
    const messageIndex = conversationHistory.findIndex(msg => msg.id === editingMessageId);
    if (messageIndex > -1) {
      conversationHistory[messageIndex] = {
        ...conversationHistory[messageIndex],
        text: currentText,
        imageUrl: currentImageUrl,
        isEdited: true
      };
      // 2. Clear all subsequent messages from local state and UI
      clearMessagesAfter(editingMessageId);
      // Update the UI for the edited message
      updateMessageElement(editingMessageId, currentText, currentImageUrl, true);
    }
    cancelEditMessage(); // Exit editing mode
  } else {
    // Add new user message to chat
    const newMessageData = { id: generateMessageId(), text: currentText, imageUrl: currentImageUrl, sender: 'user' };
    addNewMessageToChat(newMessageData);
    conversationHistory.push(newMessageData);
  }

  // Clear input
  msgInput.value = '';
  msgInput.style.height = 'auto';
  removeSelectedImage();
  updateSendButton();

  // Remove existing AI typing indicator if present (e.g., from a previous regeneration)
  const existingTyping = document.getElementById('typingIndicator');
  if (existingTyping) existingTyping.remove();

  const typingEl = addTypingIndicator();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: currentText || (currentImageUrl ? 'What is this image?' : ''),
        imageUrl: currentImageUrl || null,
        sessionId: sessionId, // Send persistent sessionId for memory continuity
        history: conversationHistory.map(msg => {
          const parts = [{ text: msg.text || '' }];
          if (msg.imageUrl) {
            parts.push({ image_url: msg.imageUrl });
          }
          return {
            role: msg.sender === 'user' ? 'user' : 'model',
            parts: parts,
          };
        })
      })
    });

    const data = await response.json();

    if (typingEl) typingEl.remove();

    // Check for both HTTP errors and application-level errors
    if (!response.ok) {
      addErrorMessage('🤖 L\'AI khaso yerta7 chwia. 3awed jarrab ba3d da9i9a.');
      unlockRequest();
      return;
    }

    // Application-level error with friendly message
    if (data.success === false) {
      const aiMessage = { id: generateMessageId(), text: data.reply || '🤖 L\'AI khaso yerta7 chwia. 3awed jarrab ba3d da9i9a.', sender: 'ai' };
      addNewMessageToChat(aiMessage);
      conversationHistory.push(aiMessage);
      
      // Save after error too, so user can revisit
      if (currentConversation) {
        currentConversation.messages = JSON.parse(JSON.stringify(conversationHistory));
        saveMessagesToConversation();
      }
      
      unlockRequest();
      return;
    }

    const replyText = data.reply || data.message || data.analysis;
    const aiMessage = { id: generateMessageId(), text: replyText, sender: 'ai' };
    addNewMessageToChat(aiMessage);
    conversationHistory.push(aiMessage);
    
    // Save all messages to current conversation
    if (currentConversation) {
      currentConversation.messages = JSON.parse(JSON.stringify(conversationHistory));
      
      // If this was the first message, generate title from it
      if (isFirstMessage) {
        const title = generateTitle(currentText);
        currentConversation.title = title;
      }
      
      saveConversations();
      renderConversationList();
      updateChatTitle();
    }

  } catch (err) {
    if (typingEl) typingEl.remove();
    addErrorMessage(err.message);
    
    // Save even on error so messages aren't lost
    if (currentConversation) {
      currentConversation.messages = JSON.parse(JSON.stringify(conversationHistory));
      saveMessagesToConversation();
    }
  }

  unlockRequest();
}

// ====================
// IMAGE EDITING
// ====================

// Removed image editing as per instructions
// ====================
// CHAT MESSAGE BUILDERS
// ====================

function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function renderMessage(messageData) {
  const row = document.createElement('div');
  row.className = `message-row ${messageData.sender}-row`;
  row.id = `message-${messageData.id}`;
  row.style.animationDelay = '0s'; // Reset animation delay

  if (messageData.sender === 'user') {
    let content = '';
    if (messageData.imageUrl) {
      content += `
        <div class="message-image-container">
          <img src="${messageData.imageUrl}" class="message-image chat-image img-fade-in" onclick="openImageModal('${messageData.imageUrl}')" alt="User uploaded image" loading="lazy">
          <div class="image-actions">
            <button class="image-action-btn" onclick="downloadImage('${messageData.imageUrl}')" title="Download">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download
            </button>
          </div>
        </div>`;
    }
    if (messageData.text) {
      content += `<div class="user-text">${escapeHtml(messageData.text)}</div>`;
    }

    row.innerHTML = `
      <div class="message-bubble user-bubble">
        ${content}
      </div>
      ${messageData.isEdited ? '<div class="message-edited-badge">Edited</div>' : ''}`;
    
    // Click on the user bubble to start editing
    row.querySelector('.user-bubble').addEventListener('click', (e) => {
      // Don't trigger if clicking on the image or image action buttons
      if (e.target.closest('.message-image-container') || e.target.closest('.image-actions')) return;
      startEditMessage(messageData.id);
    });
  } else { // AI message
  row.innerHTML = `
    <div class="message-avatar">
      <img src="/logo.svg" alt="OXY" style="width:22px;height:22px;display:block" />
    </div>
      <div class="message-bubble ai-bubble">${parseAndRenderMarkdown(messageData.text)}</div>`;
  }
  return row;
}

function addNewMessageToChat(messageData) {
  messages.push(messageData);
  const messageElement = renderMessage(messageData);
  chatContainer.appendChild(messageElement);
  scrollToBottom();
  attachCodeBlockListeners();
  attachImageClickListeners();
}


function updateMessageElement(id, newText, newImageUrl, isEdited) {
  const messageElement = document.getElementById(`message-${id}`);
  if (!messageElement) return;

  // Find the message in the global messages array and update it
  const messageIndex = messages.findIndex(msg => msg.id === id);
  if (messageIndex > -1) {
    messages[messageIndex] = {
      ...messages[messageIndex],
      text: newText,
      imageUrl: newImageUrl,
      isEdited: isEdited
    };
  }

  let content = '';
  if (newImageUrl) {
    content += `
      <div class="message-image-container">
        <img src="${newImageUrl}" class="message-image chat-image img-fade-in" onclick="openImageModal('${newImageUrl}')" alt="User uploaded image" loading="lazy">
        <div class="image-actions">
          <button class="image-action-btn" onclick="downloadImage('${newImageUrl}')" title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
      </div>
    </div>`;
  }
  if (newText) {
    content += `<div class="user-text">${escapeHtml(newText)}</div>`;
  }

  const userBubble = messageElement.querySelector('.message-bubble.user-bubble');
  if (userBubble) {
    userBubble.innerHTML = `${content}`;
  }
  
  // Update or add edited badge
  let editedBadge = messageElement.querySelector('.message-edited-badge');
  if (isEdited) {
    if (!editedBadge) {
      editedBadge = document.createElement('div');
      editedBadge.className = 'message-edited-badge';
      messageElement.appendChild(editedBadge);
    }
    editedBadge.textContent = 'Edited';
  } else if (editedBadge) {
    editedBadge.remove();
  }
  
  scrollToBottom();
  attachImageClickListeners();
}

function clearMessagesAfter(messageId) {
  const index = messages.findIndex(msg => msg.id === messageId);
  if (index === -1) return;

  // Remove messages from the DOM
  for (let i = index + 1; i < messages.length; i++) {
    const elementToRemove = document.getElementById(`message-${messages[i].id}`);
    if (elementToRemove) {
      elementToRemove.remove();
    }
  }
  // Truncate the messages array
  messages.splice(index + 1);
  
  // Save the updated state after clearing
  if (currentConversation) {
    currentConversation.messages = JSON.parse(JSON.stringify(messages));
    saveMessagesToConversation();
  }
}


function startEditMessage(id) {
  const messageToEdit = messages.find(msg => msg.id === id);
  if (!messageToEdit || messageToEdit.sender !== 'user') return; // Only allow editing user messages

  editingMessageId = id;
  msgInput.value = messageToEdit.text;
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
  inputArea.classList.add('editing-mode');
  editControls.style.display = 'flex';
  sendBtn.style.display = 'none';
    msgInput.focus();

  // Add a class to the message being edited for visual feedback
  const messageElement = document.getElementById(`message-${id}`);
  if (messageElement) {
    messageElement.classList.add('editing-active');
  }

  if (messageToEdit.imageUrl) {
    uploadedImageUrl = messageToEdit.imageUrl;
    // Simulate file for preview display, though actual file won't be re-uploaded
    selectedFile = { name: 're-attached-image.png', size: 0 };
    displayPreview();
  } else {
  removeSelectedImage();
  }
  updateSendButton();
  scrollToBottom();
}

function cancelEditMessage() {
  const activeEditElement = document.querySelector('.message-row.editing-active');
  if (activeEditElement) {
    activeEditElement.classList.remove('editing-active');
  }

  editingMessageId = null;
  msgInput.value = '';
  msgInput.style.height = 'auto';
  removeSelectedImage();
  inputArea.classList.remove('editing-mode');
  editControls.style.display = 'none';
  sendBtn.style.display = 'block';
updateSendButton();
}

saveEditBtn.addEventListener('click', sendMessage); // sendMessage will handle the update
cancelEditBtn.addEventListener('click', cancelEditMessage);

// Deprecated: Use addNewMessageToChat instead
function addUserMessage(text, imageUrl) {
  console.warn("addUserMessage is deprecated. Use addNewMessageToChat instead.");
  addNewMessageToChat({ id: generateMessageId(), text, imageUrl, sender: 'user' });
}

// Deprecated: Use addNewMessageToChat instead
function addAIMessage(text) {
  console.warn("addAIMessage is deprecated. Use addNewMessageToChat instead.");
  addNewMessageToChat({ id: generateMessageId(), text, sender: 'ai' });
}

// Deprecated: This was for image editing which is removed.
function addAIMessageWithImage(text, imageUrl, editPrompt) {
  console.warn("addAIMessageWithImage is deprecated and related to removed image editing feature.");
  addNewMessageToChat({ id: generateMessageId(), text: text, imageUrl: imageUrl, sender: 'ai' });
}


function addErrorMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row error-row';
  row.id = `message-${generateMessageId()}`; // Give error messages an ID too
  row.style.animationDelay = '0s';
  row.innerHTML = `
    <div class="message-bubble error-bubble">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      ${escapeHtml(text)}
    </div>`;
  chatContainer.appendChild(row);
  scrollToBottom();
}

function addTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row ai-row';
  row.id = 'typingIndicator';
  row.style.animationDelay = '0s';
  row.innerHTML = `
    <div class="message-avatar">
      <img src="/logo.svg" alt="OXY" style="width:22px;height:22px;display:block" />
    </div>
    <div class="message-bubble ai-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  chatContainer.appendChild(row);
  scrollToBottom();
  return row;
}

// Removed image loading placeholder as image editing is removed
/*
function addImageLoadingPlaceholder(text) {
  const row = document.createElement('div');
  row.className = 'message-row ai-row';
  row.style.animationDelay = '0s';
  row.innerHTML = `
    <div class="message-avatar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    </div>

    <div class="message-bubble ai-bubble">\
      <div class="image-loading-placeholder">
        <div class="image-loading-spinner"></div>
        <span>${escapeHtml(text || 'Generating image...')}</span>
      </div>
    </div>`;
  chatContainer.appendChild(row);
  scrollToBottom();
  return row;
}
*/

// ====================
// IMAGE ACTIONS
// ====================

function downloadImage(src) {
  const a = document.createElement('a');
  a.href = src;
  a.download = src.split('/').pop() || 'image.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function copyImageToClipboard(src) {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    showToast('✅ Image copied to clipboard', 'success');
  } catch (err) {
    showToast('❌ Failed to copy image', 'error');
  }
}

function attachImageClickListeners() {
  document.querySelectorAll('.chat-image').forEach(img => {
    img.addEventListener('click', () => {
      openImageModal(img.src);
    });
  });
}

// Removed image editing trigger
/*
function attachEditTriggers() {
  document.querySelectorAll('.edit-trigger-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const imageUrl = btn.dataset.url;
      const editPrompt = prompt('✏️ Describe how to edit this image:', '');
      if (editPrompt && editPrompt.trim()) {
        triggerEditFlow(imageUrl, editPrompt);
      }
    });
  });
}

async function triggerEditFlow(imageUrl, editPrompt) {
  const userRow = document.createElement('div');
  userRow.className = 'message-row user-row';
  userRow.style.animationDelay = '0s';
  userRow.innerHTML = `
    <div class="message-bubble user-bubble">
      <div style="display:flex;align-items:center;gap:6px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        Edit image: ${escapeHtml(editPrompt)}
      </div>
    </div>`;
  chatContainer.appendChild(userRow);
  scrollToBottom();

  const placeholderEl = addImageLoadingPlaceholder('✏️ Editing image...');

  try {
    const result = await editImage(imageUrl, editPrompt);
    placeholderEl.remove();
    if (result.success) {
      addAIMessageWithImage(
        result.message || 'Here is the edited image:',
        result.imageUrl,
        editPrompt
      );
      showToast('✅ Image edited successfully!', 'success');
    } else if (result.error === 'quota_exhausted_gemini_only') {
      addAIMessage('✏️ ' + result.message);
    } else {
      addErrorMessage(result.message || 'Image editing failed');
    }
  } catch (err) {
    placeholderEl.remove();
    addErrorMessage(err.message);
  }
}
*/

// ====================
// TOAST NOTIFICATIONS
// ====================

function showToast(message, type) {
  if (!type) type = 'info';
  const container = document.getElementById('toastContainer');
  if (!container) {
    const newContainer = document.createElement('div');
    newContainer.id = 'toastContainer';
    newContainer.className = 'toast-container';
    document.body.appendChild(newContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = message;

  const container2 = document.getElementById('toastContainer');
  container2.appendChild(toast);

  setTimeout(function () {
    toast.classList.add('toast-hide');
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}

// ====================
// SCROLL
// ====================

function scrollToBottom() {
  setTimeout(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }, 50);
}

// ====================
// KEYBOARD SHORTCUTS
// ====================

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// ─── Suggestion chips ─────────────────────────────────────────
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const msg = chip.dataset.msg;
    msgInput.value = msg;
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
    updateSendButton();
    msgInput.focus();
  });
});

// ====================
// MODAL HANDLERS
// ====================

document.getElementById('modalClose').addEventListener('click', closeImageModal);
document.getElementById('modalBackdrop').addEventListener('click', closeImageModal);
document.getElementById('modalDownload').addEventListener('click', function () {
  if (currentModalSrc) downloadImage(currentModalSrc);
});
document.getElementById('modalOpen').addEventListener('click', function () {
  if (currentModalSrc) window.open(currentModalSrc, '_blank');
});
document.getElementById('modalCopy').addEventListener('click', function () {
  if (currentModalSrc) copyImageToClipboard(currentModalSrc);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageModal();
});

// ====================
// SIDEBAR TOGGLE (mobile)
// ====================

document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.classList.toggle('active');
});

document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

const sidebarOverlay = document.getElementById('sidebarOverlay');
if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    sidebarOverlay.classList.remove('active');
  });
}

// ─── New Chat Button ──────────────────────────────────────────
document.getElementById('newChatBtn').addEventListener('click', () => {
  // Cancel any editing state
  if (editingMessageId) {
    cancelEditMessage();
  }
  
  // Clear the chat
  const messageElements = chatContainer.querySelectorAll('.message-row');
  messageElements.forEach(m => m.remove());
  messages = [];
  welcomeScreen.style.display = 'flex';
  removeSelectedImage();
  msgInput.value = '';
  msgInput.style.height = 'auto';
  updateSendButton();
  
  // Create new conversation
  createNewConversation();
  
  // Generate new session
  sessionId = generateSessionId();
  console.log(`🗣️ [MEMORY] New chat session started: ${sessionId}`);
});

// ─── Context Menu Buttons ─────────────────────────────────────
document.getElementById('renameConversationBtn').addEventListener('click', () => {
  const convId = contextMenuTargetId;
  closeContextMenu();
  if (!convId) return;
  
  const conversation = conversations.find(c => c.id === convId);
  if (!conversation) return;
  
  const newTitle = prompt('Rename conversation:', conversation.title);
  if (newTitle && newTitle.trim() && newTitle.trim() !== conversation.title) {
    renameConversation(convId, newTitle.trim());
  }
});

document.getElementById('deleteConversationBtn').addEventListener('click', () => {
  const convId = contextMenuTargetId;
  closeContextMenu();
  if (!convId) return;
  
  if (confirm('Are you sure you want to delete this conversation?')) {
    deleteConversation(convId);
    showToast('✅ Conversation deleted', 'success');
  }
});

// Close context menu on scroll
document.addEventListener('scroll', closeContextMenu, true);
window.addEventListener('resize', closeContextMenu);

updateSendButton();

// ─── Initialize conversation system on page load ──────────────
initConversationSystem();

// ====================
// PWA SERVICE WORKER
// ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }).catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}