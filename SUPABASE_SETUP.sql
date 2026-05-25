/**
 * Supabase Database Setup and Migration
 * 
 * This file contains the SQL queries to set up the database schema.
 * 
 * Steps to set up:
 * 1. Go to https://supabase.com and create a new project
 * 2. Go to the SQL Editor in your Supabase dashboard
 * 3. Copy and run each SQL statement below
 * 4. Add SUPABASE_URL and SUPABASE_ANON_KEY to your .env.local file
 */

-- ============================================================================
-- 1. Create Users Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- ============================================================================
-- 2. Create Conversations Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  conversation_id VARCHAR(255) UNIQUE NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  title VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_id ON conversations(conversation_id);

-- ============================================================================
-- 3. Create Messages Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  message_id VARCHAR(255) UNIQUE NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

-- ============================================================================
-- Enable RLS (Row Level Security) for production security
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Optional: Create policies for RLS (adjust based on your auth strategy)
-- ============================================================================
-- Users can only read/write their own conversations
CREATE POLICY "Users can read own conversations" ON conversations
  FOR SELECT USING (user_id = current_user_id());

CREATE POLICY "Users can create own conversations" ON conversations
  FOR INSERT WITH CHECK (user_id = current_user_id());

CREATE POLICY "Users can update own conversations" ON conversations
  FOR UPDATE USING (user_id = current_user_id());

CREATE POLICY "Users can delete own conversations" ON conversations
  FOR DELETE USING (user_id = current_user_id());

-- ============================================================================
-- Optional: Create stored procedures for common operations
-- ============================================================================
CREATE OR REPLACE FUNCTION get_conversation_with_messages(p_conversation_id VARCHAR)
RETURNS TABLE (
  conversation_id VARCHAR,
  user_id VARCHAR,
  title VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  messages JSON
) AS $$
SELECT 
  c.conversation_id,
  c.user_id,
  c.title,
  c.created_at,
  c.updated_at,
  COALESCE(json_agg(json_build_object(
    'message_id', m.message_id,
    'role', m.role,
    'content', m.content,
    'timestamp', m.timestamp
  ) ORDER BY m.timestamp), '[]'::json) as messages
FROM conversations c
LEFT JOIN messages m ON c.conversation_id = m.conversation_id
WHERE c.conversation_id = p_conversation_id
GROUP BY c.id, c.conversation_id, c.user_id, c.title, c.created_at, c.updated_at;
$$ LANGUAGE SQL;
