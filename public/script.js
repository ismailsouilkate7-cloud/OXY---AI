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

let conversations = [];
let activeConversationId = null;
let currentConversation = null;

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
  
  try {
    const activeId = localStorage.getItem(ACTIVE_CONV_KEY);
    if (activeId) {
      activeConversationId = activeId;
      currentConversation = conversations.find(c => c.id === activeId) || null;
    }
  } catch (e) {
    console.warn('Failed to load active conversation:', e);
  }
  
  if (!currentConversation && conversations.length > 0) {
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    currentConversation = conversations[0];
    activeConversationId = currentConversation.id;
    saveActiveConversationId();
  }
}

function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (e) {
    console.warn('Failed to save conversations:', e);
  }
}

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

function generateConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateTitle(text) {
  if (!text || !text.trim()) return 'New Chat';
  
  let normalized = text.trim().toLowerCase();
  const noiseWords = /\b(hi|hello|hey|salam|slm|slt|assalamu|alaykum|wa|alaikum|marhaba|ahlan|bien|bonjour|salut|good|morning|afternoon|evening|please|pls|can|could|would|will|may|should|might|must|the|a|an|is|are|was|were|been|being|do|does|did|done|doing|how|what|why|when|where|which|who|whom|whose|this|that|these|those|i|my|me|we|our|us|you|your|yours|he|she|it|they|them|their|create|make|write|build|show|tell|give|need|want|have|has|had|having|with|for|to|of|in|on|at|by|from|as|be|not|no|or|and|but|if|so|than|that|just|about|up|out|off|over|also|very|really|like|get|got|use|used|using|into|onto|upon|some|any|all|every|each|both|few|more|most|much|many|such|only|own|same|too|well|now|then|here|there|please|tell|explain|describe|define|list|give|help|assist)\b/gi;
  normalized = normalized.replace(noiseWords, ' ').trim();
  normalized = normalized.replace(/[^a-zA-Z0-9\s.\-]/g, ' ').trim();
  normalized = normalized.replace(/\s+/g, ' ');
  let words = normalized.split(/\s+/).filter(w => w.length >= 2);
  
  if (words.length === 0) {
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
  
  if (words.length > 3) {
    words = words.slice(0, 3);
  }
  
  let title = words.map(word => {
    if (word.includes('.')) {
      return word.split('.').map((part, i) => 
        i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part
      ).join('.');
    }
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
  
  if (title.length > 30) {
    title = title.substring(0, 27) + '...';
  }
  
  if (title.length < 3) {
    title = 'New Chat';
  }
  
  return title;
}

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
  
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString('en-US', options);
}

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

function switchToConversation(conversationId) {
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return;
  
  if (editingMessageId) {
    cancelEditMessage();
  }
  
  activeConversationId = conversationId;
  currentConversation = conversation;
  saveActiveConversationId();
  
  messages = JSON.parse(JSON.stringify(conversation.messages));
  
  const messageElements = chatContainer.querySelectorAll('.message-row');
  messageElements.forEach(m => m.remove());
  
  if (messages.length === 0) {
    welcomeScreen.style.display = 'flex';
  } else {
    welcomeScreen.style.display = 'none';
    messages.forEach(msg => {
      const el = renderMessage(msg);
      chatContainer.appendChild(el);
    });
    scrollToBottom();
    attachCodeBlockListeners();
    attachImageClickListeners();
  }
  
  renderConversationList();
  updateChatTitle();
  
  sessionId = `session_${conversationId}_${Date.now()}`;
  localStorage.setItem('oxy_session_id', sessionId);
}

function updateConversationTitle(title) {
  if (!currentConversation) return;
  
  currentConversation.title = title;
  currentConversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
  updateChatTitle();
}

function saveMessagesToConversation() {
  if (!currentConversation) return;
  
  currentConversation.messages = JSON.parse(JSON.stringify(messages));
  currentConversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
}

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

function deleteConversation(conversationId) {
  const index = conversations.findIndex(c => c.id === conversationId);
  if (index === -1) return;
  
  conversations.splice(index, 1);
  saveConversations();
  
  if (activeConversationId === conversationId) {
    if (conversations.length > 0) {
      switchToConversation(conversations[0].id);
    } else {
      activeConversationId = null;
      currentConversation = null;
      messages = [];
      localStorage.removeItem(ACTIVE_CONV_KEY);
      
      const messageElements = chatContainer.querySelectorAll('.message-row');
      messageElements.forEach(m => m.remove());
      welcomeScreen.style.display = 'flex';
      chatTitle.textContent = 'OXY AI';
      
      renderConversationList();
      sessionId = generateSessionId();
    }
  } else {
    renderConversationList();
  }
}

function updateChatTitle() {
  const chatTitle = document.getElementById('chatTitle');
  if (currentConversation && messages.length > 0) {
    chatTitle.textContent = currentConversation.title;
  } else {
    chatTitle.textContent = 'OXY AI';
  }
}

function renderConversationList() {
  const list = document.getElementById('conversationList');
  if (!list) return;
  
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
    
    item.querySelector('.conversation-item-content').addEventListener('click', (e) => {
      e.stopPropagation();
      if (conv.id !== activeConversationId) {
        switchToConversation(conv.id);
      }
    });
    
    item.querySelector('[data-action="menu"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      showContextMenu(conv.id, rect.left - 140, rect.bottom + 4);
    });
    
    list.appendChild(item);
  });
}

let contextMenuTargetId = null;

function showContextMenu(conversationId, x, y) {
  const menu = document.getElementById('conversationContextMenu');
  contextMenuTargetId = conversationId;
  
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 170)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 100)) + 'px';
  menu.style.display = 'block';
  
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

function closeContextMenu() {
  const menu = document.getElementById('conversationContextMenu');
  menu.style.display = 'none';
  contextMenuTargetId = null;
}

function initConversationSystem() {
  loadConversations();
  
  if (currentConversation) {
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
    
    sessionId = `session_${currentConversation.id}_${Date.now()}`;
    localStorage.setItem('oxy_session_id', sessionId);
  } else {
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
let uploadedImageId = null;
let isRequesting = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

let messages = [];
let editingMessageId = null;

// Streaming state
let streamMessageId = null;
let streamAbortController = null;

function generateSessionId() {
  const id = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  localStorage.setItem('oxy_session_id', id);
  console.log(`💾 [MEMORY] Created new sessionId: ${id}`);
  return id;
}

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
  editControls.style.display = 'none';
}

function unlockRequest() {
  isRequesting = false;
  msgInput.disabled = false;
  updateSendButton();
  attachBtn.disabled = false;
  if (editingMessageId) {
    editControls.style.display = 'flex';
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

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

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

previewRemoveBtn.addEventListener('click', removeSelectedImage);

function removeSelectedImage() {
  selectedFile = null;
  uploadedImageUrl = null;
  uploadedImageId = null;
  inputImagePreview.style.display = 'none';
  attachBtn.classList.remove('has-image');
  updateSendButton();
}

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

  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Upload failed. Please try again.');
  }

    uploadedImageUrl = data.imageUrl;
    uploadedImageId = data.imageId;
    displayPreview();
    updateSendButton();
    showToast('✅ Image uploaded', 'success');

  } catch (err) {
    showToast(`❌ Upload failed. Please try again.`, 'error');
    selectedFile = null;
    uploadedImageUrl = null;
    uploadedImageId = null;
  } finally {
    attachBtn.disabled = false;
    showUploadProgress(false);
  }
}

function displayPreview() {
  if (!selectedFile || !uploadedImageUrl) return;
  previewThumb.src = uploadedImageUrl;
  previewFileName.textContent = selectedFile.name;
  previewFileSize.textContent = (selectedFile.size / 1024 / 1024).toFixed(2) + ' MB';
  inputImagePreview.style.display = 'flex';
  attachBtn.classList.add('has-image');
}

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

function updateStreamingMessage(id, text) {
  const messageElement = document.getElementById(`message-${id}`);
  if (!messageElement) return;

  const aiBubble = messageElement.querySelector('.ai-bubble');
  if (aiBubble) {
    aiBubble.innerHTML = parseAndRenderMarkdown(text);
  }
}

async function sendMessage() {
  if (!canSendRequest()) {
    showToast('⏳ Please wait, a request is already in progress.', 'info');
    return;
  }

  const text = msgInput.value.trim();
  const hasImage = uploadedImageUrl !== null;

  if (!text && !hasImage) return;

  if (streamAbortController) {
    streamAbortController.abort();
    streamAbortController = null;
  }

  lockRequest();

  welcomeScreen.style.display = 'none';

  const currentImageUrl = uploadedImageUrl;
  const currentImageId = uploadedImageId;
  const currentText = text;

  let conversationHistory = [...messages];
  let isFirstMessage = messages.length === 0;

  if (editingMessageId) {
    const messageIndex = conversationHistory.findIndex(msg => msg.id === editingMessageId);
    if (messageIndex > -1) {
      conversationHistory[messageIndex] = {
        ...conversationHistory[messageIndex],
        text: currentText,
        imageUrl: currentImageUrl,
        isEdited: true
      };
      clearMessagesAfter(editingMessageId);
      updateMessageElement(editingMessageId, currentText, currentImageUrl, true);
    }
    cancelEditMessage();
  } else {
    const newMessageData = { id: generateMessageId(), text: currentText, imageUrl: currentImageUrl, sender: 'user' };
    addNewMessageToChat(newMessageData);
    conversationHistory.push(newMessageData);
  }

  msgInput.value = '';
  msgInput.style.height = 'auto';
  removeSelectedImage();
  updateSendButton();

  streamAbortController = new AbortController();
  let fullReply = '';
  let firstTokenReceived = false;

  // Show typing indicator immediately — it will be swapped for the real bubble on first token
  streamMessageId = generateMessageId();
  addTypingIndicator();

  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: currentText || (currentImageId ? 'What is this image?' : ''),
        imageId: currentImageId || null,
        sessionId: sessionId,
      }),
      signal: streamAbortController.signal,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const fallback = `DEBUG ERROR: Server returned HTTP ${response.status} ${response.statusText}. Check Vercel logs.`;
      fullReply = errData.reply || fallback;

      const msgIndex = messages.findIndex(m => m.id === streamMessageId);
      if (msgIndex !== -1) {
        messages[msgIndex].text = fullReply;
      }
      updateStreamingMessage(streamMessageId, fullReply);

      conversationHistory.push({ id: streamMessageId, text: fullReply, sender: 'ai' });
      if (currentConversation) {
        currentConversation.messages = JSON.parse(JSON.stringify(conversationHistory));
        if (isFirstMessage) {
          const title = generateTitle(currentText);
          currentConversation.title = title;
        }
        saveConversations();
        renderConversationList();
        updateChatTitle();
      }

      streamAbortController = null;
      unlockRequest();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const event of events) {
        const trimmed = event.trim();
        if (!trimmed) continue;

        let jsonStr = trimmed;
        if (jsonStr.startsWith('data: ')) {
          jsonStr = jsonStr.slice(6);
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (parsed.token) {
          // First token: swap typing indicator for real streaming bubble
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            const typingEl = document.getElementById('typingIndicator');
            if (typingEl) typingEl.remove();
            const streamMessageData = { id: streamMessageId, text: '', sender: 'ai' };
            messages.push(streamMessageData);
            const messageElement = renderMessage(streamMessageData);
            chatContainer.appendChild(messageElement);
          }
          fullReply += parsed.token;
          updateStreamingMessage(streamMessageId, fullReply);
          scrollToBottom();
          attachCodeBlockListeners();
        }

        if (parsed.error) {
          fullReply = parsed.message || fullReply;
          updateStreamingMessage(streamMessageId, fullReply);
        }

        if (parsed.done) {
          if (parsed.fullText) {
            fullReply = parsed.fullText;
          }
          break;
        }
      }
    }

    if (buffer.trim()) {
      let jsonStr = buffer.trim();
      if (jsonStr.startsWith('data: ')) jsonStr = jsonStr.slice(6);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.token) fullReply += parsed.token;
        if (parsed.fullText) fullReply = parsed.fullText;
      } catch {}
    }

    // Ensure typing indicator is removed in all end-of-stream cases
    const typingEl = document.getElementById('typingIndicator');
    if (typingEl) {
      typingEl.remove();
      // If no bubble rendered yet (empty stream), render one now
      if (!firstTokenReceived) {
        const streamMessageData = { id: streamMessageId, text: '', sender: 'ai' };
        messages.push(streamMessageData);
        const messageElement = renderMessage(streamMessageData);
        chatContainer.appendChild(messageElement);
      }
    }

    if (!fullReply) {
      fullReply = "I'm a bit busy right now, but I'm still here to help you 😊";
    }
    updateStreamingMessage(streamMessageId, fullReply);

    const msgIndex = messages.findIndex(m => m.id === streamMessageId);
    if (msgIndex !== -1) {
      messages[msgIndex].text = fullReply;
    }

    conversationHistory.push({ id: streamMessageId, text: fullReply, sender: 'ai' });

    if (currentConversation) {
      currentConversation.messages = JSON.parse(JSON.stringify(conversationHistory));
      
      if (isFirstMessage) {
        const title = generateTitle(currentText);
        currentConversation.title = title;
      }
      
      saveConversations();
      renderConversationList();
      updateChatTitle();
    }

    // Send notification when AI reply completes
    sendAINotification();

  } catch (err) {
    // Always remove typing indicator on error
    const typingEl = document.getElementById('typingIndicator');
    if (typingEl) {
      typingEl.remove();
      if (!firstTokenReceived) {
        const streamMessageData = { id: streamMessageId, text: '', sender: 'ai' };
        messages.push(streamMessageData);
        const messageElement = renderMessage(streamMessageData);
        chatContainer.appendChild(messageElement);
      }
    }

    if (err.name === 'AbortError') {
      console.log('⚠️ Stream aborted by user');
      return;
    }

    console.error('Stream error:', err);
    
    if (!fullReply) {
      fullReply = `DEBUG FETCH ERROR: ${err.message}`;
    }
    updateStreamingMessage(streamMessageId, fullReply);

    const msgIndex = messages.findIndex(m => m.id === streamMessageId);
    if (msgIndex !== -1) {
      messages[msgIndex].text = fullReply;
    }
    conversationHistory.push({ id: streamMessageId, text: fullReply, sender: 'ai' });
    
    if (currentConversation) {
      currentConversation.messages = JSON.parse(JSON.stringify(conversationHistory));
      saveMessagesToConversation();
    }
  }

  streamAbortController = null;
  unlockRequest();
}

function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function renderMessage(messageData) {
  const row = document.createElement('div');
  row.className = `message-row ${messageData.sender}-row`;
  row.id = `message-${messageData.id}`;
  row.style.animationDelay = '0s';

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
    
    row.querySelector('.user-bubble').addEventListener('click', (e) => {
      if (e.target.closest('.message-image-container') || e.target.closest('.image-actions')) return;
      startEditMessage(messageData.id);
    });
  } else {
    const displayText = messageData.text || '';
    row.innerHTML = `
    <div class="message-avatar">
      <img src="/logo.svg" alt="OXY" style="width:22px;height:22px;display:block" />
    </div>
      <div class="message-bubble ai-bubble">${displayText ? parseAndRenderMarkdown(displayText) : ''}</div>`;
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

  for (let i = index + 1; i < messages.length; i++) {
    const elementToRemove = document.getElementById(`message-${messages[i].id}`);
    if (elementToRemove) {
      elementToRemove.remove();
    }
  }
  messages.splice(index + 1);
  
  if (currentConversation) {
    currentConversation.messages = JSON.parse(JSON.stringify(messages));
    saveMessagesToConversation();
  }
}

function startEditMessage(id) {
  const messageToEdit = messages.find(msg => msg.id === id);
  if (!messageToEdit || messageToEdit.sender !== 'user') return;

  editingMessageId = id;
  msgInput.value = messageToEdit.text;
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
  inputArea.classList.add('editing-mode');
  editControls.style.display = 'flex';
  sendBtn.style.display = 'none';
    msgInput.focus();

  const messageElement = document.getElementById(`message-${id}`);
  if (messageElement) {
    messageElement.classList.add('editing-active');
  }

  if (messageToEdit.imageUrl) {
    uploadedImageUrl = messageToEdit.imageUrl;
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

saveEditBtn.addEventListener('click', sendMessage);
cancelEditBtn.addEventListener('click', cancelEditMessage);

function addErrorMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row error-row';
  row.id = `message-${generateMessageId()}`;
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
  // Remove any stale indicator before adding a new one
  const stale = document.getElementById('typingIndicator');
  if (stale) stale.remove();

  const row = document.createElement('div');
  row.className = 'message-row ai-row';
  row.id = 'typingIndicator';
  row.style.animationDelay = '0s';
  row.innerHTML = `
    <div class="message-avatar">
      <img src="/logo.svg" alt="OXY" style="width:22px;height:22px;display:block" />
    </div>
    <div class="message-bubble ai-bubble">
      <div class="typing-indicator" role="status" aria-label="AI is thinking">
        <div class="typing-bar"></div>
        <div class="typing-bar"></div>
        <div class="typing-bar"></div>
      </div>
      <span class="typing-label">OXY is thinking…</span>
    </div>`;
  chatContainer.appendChild(row);
  scrollToBottom();
  return row;
}

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

function scrollToBottom() {
  setTimeout(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }, 50);
}

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

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

document.getElementById('newChatBtn').addEventListener('click', () => {
  if (editingMessageId) {
    cancelEditMessage();
  }
  
  const messageElements = chatContainer.querySelectorAll('.message-row');
  messageElements.forEach(m => m.remove());
  messages = [];
  welcomeScreen.style.display = 'flex';
  removeSelectedImage();
  msgInput.value = '';
  msgInput.style.height = 'auto';
  updateSendButton();
  
  createNewConversation();
  sessionId = generateSessionId();
  console.log(`🗣️ [MEMORY] New chat session started: ${sessionId}`);
});

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

document.addEventListener('scroll', closeContextMenu, true);
window.addEventListener('resize', closeContextMenu);

updateSendButton();

// ====================
// PWA NOTIFICATIONS
// ====================

let notificationPermissionRequested = false;

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('📵 Notifications not supported in this browser');
    return;
  }

  if (Notification.permission === 'granted') {
    notificationPermissionRequested = true;
    console.log('🔔 Notifications already granted');
    return;
  }

  if (Notification.permission === 'denied') {
    console.log('🔕 Notifications denied by user');
    return;
  }

  if (notificationPermissionRequested) return;
  notificationPermissionRequested = true;

  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      console.log('🔔 Notification permission granted');
    } else {
      console.log('🔕 Notification permission denied');
    }
  }).catch((err) => {
    console.log('🔕 Notification permission error:', err);
  });
}

function sendAINotification() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notification = new Notification('OXY AI 🤖', {
      body: 'OXY AI replied to your message',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'oxy-ai-response',
      vibrate: [200, 100, 200],
    });
    notification.onshow = () => console.log('🔔 Notification sent');
  } catch (err) {
    console.log('🔕 Notification error:', err);
  }
}

requestNotificationPermission();

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

// ─── Initialize conversation system on page load ──────────────
initConversationSystem();