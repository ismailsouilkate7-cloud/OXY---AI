/**
 * Conversation Service
 * Replaces file-based memoryStore with Supabase database operations
 * 
 * Handles:
 * - User creation and management
 * - Conversation creation and retrieval
 * - Message storage and retrieval
 * - Production-ready multi-user support
 */

import supabase from "./db.js";
import { v4 as uuidv4 } from "uuid";

const MAX_MESSAGES_PER_SESSION = 20; // Keep last 20 messages for context

class ConversationService {
  /**
   * Initialize database tables (run once on startup)
   */
  static async initializeDatabase() {
    try {
      console.log("📋 [DB] Checking database tables...");

      // Check if users table exists by querying it
      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id")
        .limit(1);

      if (usersError && usersError.code === "PGRST116") {
        console.log("📋 [DB] Creating users table...");
        await supabase.rpc("create_users_table").catch(() => {
          // Table might already exist, continue
        });
      }

      // Check if conversations table exists
      const { data: convData, error: convError } = await supabase
        .from("conversations")
        .select("id")
        .limit(1);

      if (convError && convError.code === "PGRST116") {
        console.log("📋 [DB] Creating conversations table...");
        await supabase.rpc("create_conversations_table").catch(() => {
          // Table might already exist, continue
        });
      }

      // Check if messages table exists
      const { data: msgData, error: msgError } = await supabase
        .from("messages")
        .select("id")
        .limit(1);

      if (msgError && msgError.code === "PGRST116") {
        console.log("📋 [DB] Creating messages table...");
        await supabase.rpc("create_messages_table").catch(() => {
          // Table might already exist, continue
        });
      }

      console.log("✅ [DB] Database tables ready");
    } catch (error) {
      console.error("⚠️  [DB] Database initialization warning:", error.message);
      // Continue anyway - tables might already exist
    }
  }

  /**
   * Create or get a user by ID
   * @param {string} userId - Unique user identifier
   * @param {object} userData - Optional user data (name, email, etc.)
   * @returns {Promise<object>} User object
   */
  static async getOrCreateUser(userId, userData = {}) {
    try {
      console.log(`👤 [DB] Getting or creating user: ${userId}`);

      // Check if user exists
      const { data: existingUser, error: selectError } = await supabase
        .from("users")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (existingUser) {
        console.log(`✅ [DB] User found: ${userId}`);
        return existingUser;
      }

      // User doesn't exist, create new one
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert([
          {
            user_id: userId,
            name: userData.name || null,
            email: userData.email || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (insertError) {
        console.error(`❌ [DB] Failed to create user: ${insertError.message}`);
        throw insertError;
      }

      console.log(`🆕 [DB] User created: ${userId}`);
      return newUser;
    } catch (error) {
      console.error(`❌ [DB] getOrCreateUser error:`, error.message);
      throw error;
    }
  }

  /**
   * Create a new conversation for a user
   * @param {string} userId - User ID
   * @param {string} title - Conversation title
   * @returns {Promise<object>} Conversation object with conversationId
   */
  static async createConversation(userId, title = "New Conversation") {
    try {
      // Ensure user exists
      await this.getOrCreateUser(userId);

      const conversationId = `conv_${uuidv4()}`;
      console.log(`📝 [DB] Creating conversation: ${conversationId} for user: ${userId}`);

      const { data: conversation, error } = await supabase
        .from("conversations")
        .insert([
          {
            conversation_id: conversationId,
            user_id: userId,
            title: title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(`❌ [DB] Failed to create conversation: ${error.message}`);
        throw error;
      }

      console.log(`✅ [DB] Conversation created: ${conversationId}`);
      return conversation;
    } catch (error) {
      console.error(`❌ [DB] createConversation error:`, error.message);
      throw error;
    }
  }

  /**
   * Add a message to a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} role - Message role ("user" or "assistant")
   * @param {string} content - Message content
   * @returns {Promise<object>} Message object
   */
  static async addMessage(conversationId, role, content) {
    try {
      const messageId = `msg_${uuidv4()}`;
      const timestamp = new Date().toISOString();

      console.log(
        `💬 [DB] Adding ${role} message to conversation: ${conversationId}`
      );

      const { data: message, error } = await supabase
        .from("messages")
        .insert([
          {
            message_id: messageId,
            conversation_id: conversationId,
            role: role,
            content: content,
            timestamp: timestamp,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(`❌ [DB] Failed to add message: ${error.message}`);
        throw error;
      }

      // Update conversation's updated_at timestamp
      await supabase
        .from("conversations")
        .update({ updated_at: timestamp })
        .eq("conversation_id", conversationId);

      console.log(`✅ [DB] Message added: ${messageId}`);
      return message;
    } catch (error) {
      console.error(`❌ [DB] addMessage error:`, error.message);
      throw error;
    }
  }

  /**
   * Get all messages from a conversation (optionally limited to last N)
   * @param {string} conversationId - Conversation ID
   * @param {number} limit - Max number of messages to return (0 = all)
   * @returns {Promise<array>} Array of messages
   */
  static async getConversationMessages(conversationId, limit = 0) {
    try {
      console.log(`📖 [DB] Fetching messages for conversation: ${conversationId}`);

      let query = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("timestamp", { ascending: true });

      if (limit > 0) {
        query = query.limit(limit);
      }

      const { data: messages, error } = await query;

      if (error) {
        console.error(`❌ [DB] Failed to fetch messages: ${error.message}`);
        throw error;
      }

      console.log(
        `✅ [DB] Fetched ${messages.length} messages for conversation: ${conversationId}`
      );
      return messages;
    } catch (error) {
      console.error(`❌ [DB] getConversationMessages error:`, error.message);
      throw error;
    }
  }

  /**
   * Get a conversation with its metadata
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<object>} Conversation object
   */
  static async getConversation(conversationId) {
    try {
      console.log(`🔍 [DB] Getting conversation: ${conversationId}`);

      const { data: conversation, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("conversation_id", conversationId)
        .single();

      if (error) {
        console.error(
          `❌ [DB] Failed to fetch conversation: ${error.message}`
        );
        throw error;
      }

      console.log(`✅ [DB] Conversation found: ${conversationId}`);
      return conversation;
    } catch (error) {
      console.error(`❌ [DB] getConversation error:`, error.message);
      throw error;
    }
  }

  /**
   * Get conversation with its messages
   * @param {string} conversationId - Conversation ID
   * @param {number} messageLimit - Max number of messages to include
   * @returns {Promise<object>} Conversation object with messages array
   */
  static async getConversationFull(conversationId, messageLimit = 0) {
    try {
      const conversation = await this.getConversation(conversationId);
      const messages = await this.getConversationMessages(
        conversationId,
        messageLimit
      );

      return {
        ...conversation,
        messages: messages,
      };
    } catch (error) {
      console.error(`❌ [DB] getConversationFull error:`, error.message);
      throw error;
    }
  }

  /**
   * Get all conversations for a user
   * @param {string} userId - User ID
   * @param {number} limit - Max number of conversations to return
   * @returns {Promise<array>} Array of conversations
   */
  static async getUserConversations(userId, limit = 50) {
    try {
      console.log(`📚 [DB] Fetching conversations for user: ${userId}`);

      const { data: conversations, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error(
          `❌ [DB] Failed to fetch conversations: ${error.message}`
        );
        throw error;
      }

      console.log(
        `✅ [DB] Fetched ${conversations.length} conversations for user: ${userId}`
      );
      return conversations;
    } catch (error) {
      console.error(`❌ [DB] getUserConversations error:`, error.message);
      throw error;
    }
  }

  /**
   * Get last N messages from a conversation (for context)
   * @param {string} conversationId - Conversation ID
   * @param {number} count - Number of messages to return
   * @returns {Promise<array>} Last N messages
   */
  static async getLastMessages(conversationId, count = MAX_MESSAGES_PER_SESSION) {
    return this.getConversationMessages(conversationId, count);
  }

  /**
   * Delete a conversation and all its messages
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteConversation(conversationId) {
    try {
      console.log(`🗑️  [DB] Deleting conversation: ${conversationId}`);

      // Delete messages first (foreign key constraint)
      const { error: msgError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);

      if (msgError) {
        console.error(`❌ [DB] Failed to delete messages: ${msgError.message}`);
        throw msgError;
      }

      // Then delete conversation
      const { error: convError } = await supabase
        .from("conversations")
        .delete()
        .eq("conversation_id", conversationId);

      if (convError) {
        console.error(
          `❌ [DB] Failed to delete conversation: ${convError.message}`
        );
        throw convError;
      }

      console.log(`✅ [DB] Conversation deleted: ${conversationId}`);
      return true;
    } catch (error) {
      console.error(`❌ [DB] deleteConversation error:`, error.message);
      throw error;
    }
  }

  /**
   * Delete all messages in a conversation (keep conversation metadata)
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<boolean>} Success status
   */
  static async clearConversationMessages(conversationId) {
    try {
      console.log(`🧹 [DB] Clearing messages in conversation: ${conversationId}`);

      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);

      if (error) {
        console.error(`❌ [DB] Failed to clear messages: ${error.message}`);
        throw error;
      }

      // Update conversation's updated_at timestamp
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("conversation_id", conversationId);

      console.log(`✅ [DB] Messages cleared in conversation: ${conversationId}`);
      return true;
    } catch (error) {
      console.error(`❌ [DB] clearConversationMessages error:`, error.message);
      throw error;
    }
  }

  /**
   * Get statistics about the database
   * @returns {Promise<object>} Stats object
   */
  static async getStats() {
    try {
      console.log(`📊 [DB] Fetching database statistics...`);

      const { count: userCount, error: userError } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true });

      const { count: convCount, error: convError } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true });

      const { count: msgCount, error: msgError } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true });

      if (userError || convError || msgError) {
        throw userError || convError || msgError;
      }

      const stats = {
        totalUsers: userCount || 0,
        totalConversations: convCount || 0,
        totalMessages: msgCount || 0,
      };

      console.log(`✅ [DB] Stats:`, stats);
      return stats;
    } catch (error) {
      console.error(`❌ [DB] getStats error:`, error.message);
      return {
        totalUsers: 0,
        totalConversations: 0,
        totalMessages: 0,
        error: error.message,
      };
    }
  }
}

export default ConversationService;
