/**
 * Frontend Integration Example
 * How to use the new Supabase-based chat API
 * 
 * This shows how to update your frontend to work with the new database-driven backend
 */

// ════════════════════════════════════════════════════════════════════════════════
// Example 1: Simple Chat Message
// ════════════════════════════════════════════════════════════════════════════════

async function sendChatMessage() {
  const userId = "user@example.com"; // Must be unique per user
  const conversationId = localStorage.getItem("activeConversationId") || null;
  const message = "Hello, what can you help me with?";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId, // REQUIRED: identifies the user
        conversationId, // Optional: if null, new conversation is created
        message,
      }),
    });

    const data = await response.json();

    if (data.success) {
      console.log("Reply:", data.reply);
      console.log("Conversation ID:", data.conversationId);

      // Save conversation ID for next message
      localStorage.setItem("activeConversationId", data.conversationId);
    } else {
      console.error("Error:", data.message);
    }
  } catch (error) {
    console.error("Failed to send message:", error);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Example 2: Create New Conversation
// ════════════════════════════════════════════════════════════════════════════════

async function createNewConversation() {
  const userId = "user@example.com";
  const title = "My Project Discussion";

  try {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        title,
      }),
    });

    const data = await response.json();

    if (data.success) {
      console.log("New conversation created:", data.conversation.conversation_id);
      localStorage.setItem("activeConversationId", data.conversation.conversation_id);
      return data.conversation.conversation_id;
    }
  } catch (error) {
    console.error("Failed to create conversation:", error);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Example 3: Load User's Conversations
// ════════════════════════════════════════════════════════════════════════════════

async function loadUserConversations() {
  const userId = "user@example.com";

  try {
    const response = await fetch(`/api/users/${userId}/conversations`);
    const data = await response.json();

    if (data.success) {
      console.log(`Found ${data.conversationCount} conversations`);
      data.conversations.forEach((conv) => {
        console.log(`- ${conv.title} (${conv.conversation_id})`);
      });
      return data.conversations;
    }
  } catch (error) {
    console.error("Failed to load conversations:", error);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Example 4: Load Specific Conversation with Messages
// ════════════════════════════════════════════════════════════════════════════════

async function loadConversationWithMessages(conversationId) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`);
    const data = await response.json();

    if (data.success) {
      const conv = data.conversation;
      console.log(`Conversation: ${conv.title}`);
      console.log(`Messages: ${conv.messages.length}`);

      conv.messages.forEach((msg) => {
        console.log(`[${msg.role}]: ${msg.content}`);
      });

      return conv;
    }
  } catch (error) {
    console.error("Failed to load conversation:", error);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Example 5: Chat with Image
// ════════════════════════════════════════════════════════════════════════════════

async function sendChatWithImage(imageUrl) {
  const userId = "user@example.com";
  const conversationId = localStorage.getItem("activeConversationId") || null;
  const message = "What do you see in this image?";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        conversationId,
        message,
        imageUrl, // Include image URL
      }),
    });

    const data = await response.json();

    if (data.success) {
      console.log("Image analysis reply:", data.reply);
      localStorage.setItem("activeConversationId", data.conversationId);
    } else {
      console.error("Error:", data.message);
    }
  } catch (error) {
    console.error("Failed to send message with image:", error);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Example 6: Full Chat Component (React-like pseudocode)
// ════════════════════════════════════════════════════════════════════════════════

class ChatComponent {
  constructor() {
    this.userId = null; // Set after user logs in
    this.conversationId = null;
    this.messages = [];
    this.isLoading = false;
  }

  async initialize(userId) {
    this.userId = userId;

    // Check if there's an active conversation
    const savedConvId = localStorage.getItem("activeConversationId");
    if (savedConvId) {
      this.conversationId = savedConvId;
      await this.loadMessages();
    }
  }

  async loadMessages() {
    if (!this.conversationId) return;

    try {
      const response = await fetch(
        `/api/conversations/${this.conversationId}/messages?limit=50`
      );
      const data = await response.json();

      if (data.success) {
        this.messages = data.messages;
      }
    } catch (error) {
      console.error("Failed to load messages:", error);
    }
  }

  async sendMessage(userMessage) {
    if (!this.userId) {
      alert("Please log in first");
      return;
    }

    if (this.isLoading) return;

    this.isLoading = true;

    try {
      // Add user message to UI immediately (optimistic update)
      this.messages.push({
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      });

      // Send to server
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: this.userId,
          conversationId: this.conversationId,
          message: userMessage,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update conversation ID if new
        this.conversationId = data.conversationId;
        localStorage.setItem("activeConversationId", this.conversationId);

        // Add assistant message
        this.messages.push({
          role: "assistant",
          content: data.reply,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Show error
        this.messages.push({
          role: "error",
          content: data.message || "Failed to get response",
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
      this.messages.push({
        role: "error",
        content: "Network error: " + error.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.isLoading = false;
    }
  }

  async startNewConversation(title = "New Conversation") {
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: this.userId,
          title,
        }),
      });

      const data = await response.json();

      if (data.success) {
        this.conversationId = data.conversation.conversation_id;
        this.messages = [];
        localStorage.setItem("activeConversationId", this.conversationId);
        return this.conversationId;
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  }

  async switchConversation(conversationId) {
    this.conversationId = conversationId;
    this.messages = [];
    await this.loadMessages();
    localStorage.setItem("activeConversationId", conversationId);
  }

  async deleteConversation() {
    if (!this.conversationId) return;

    try {
      await fetch(`/api/conversations/${this.conversationId}`, {
        method: "DELETE",
      });

      localStorage.removeItem("activeConversationId");
      this.conversationId = null;
      this.messages = [];
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  }

  getMessages() {
    return this.messages;
  }

  isLoading() {
    return this.isLoading;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Usage Example
// ════════════════════════════════════════════════════════════════════════════════

/*
// Initialize chat
const chat = new ChatComponent();
await chat.initialize("user@example.com");

// Send message
await chat.sendMessage("Hello, how are you?");

// View messages
console.log(chat.getMessages());

// Switch to another conversation
const conversations = await loadUserConversations();
if (conversations.length > 0) {
  await chat.switchConversation(conversations[0].conversation_id);
}

// Start new conversation
await chat.startNewConversation("New Project");

// Send another message
await chat.sendMessage("Let's discuss this project");
*/

export { ChatComponent, sendChatMessage, loadUserConversations, loadConversationWithMessages };
