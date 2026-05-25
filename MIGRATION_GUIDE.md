# Database Migration Guide: File Storage → Supabase

This guide explains the changes made to migrate from file-based storage (conversations.json) to Supabase database storage.

## 📋 Overview of Changes

### What Changed
- **Old**: Used `memoryStore.js` which persisted conversations to `data/conversations.json`
- **New**: Uses `conversationService.js` with Supabase PostgreSQL database
- **Why**: File-based storage doesn't work on Vercel (serverless environment), and databases are more scalable and secure

### What Stayed The Same
- Chat functionality works identically
- Message history still provided as context
- All error handling and logging
- Response format and API compatibility

## 🚀 Quick Setup

### Step 1: Create a Supabase Project
1. Go to https://supabase.com
2. Sign up (free account available)
3. Click "New Project"
4. Fill in:
   - Project name: `oxy-ai` (or your choice)
   - Database password: Save this securely
   - Region: Select closest to your users
5. Wait for initialization (~2 minutes)

### Step 2: Get Supabase Credentials
1. Click your project
2. Go to **Settings > API** (bottom left)
3. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **public/anon/key** → `SUPABASE_ANON_KEY`

### Step 3: Create Database Tables
1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy the entire content of `SUPABASE_SETUP.sql`
4. Paste into the editor
5. Click **Run**
6. Verify all three tables were created: `users`, `conversations`, `messages`

### Step 4: Update Environment Variables
1. Create or update `.env.local` (or `.env` for local testing):
   ```
   GEMINI_API_KEY=your_gemini_api_key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_anon_key
   ```

### Step 5: Install New Dependencies
```bash
npm install
```

This installs:
- `@supabase/supabase-js` - Supabase client
- `uuid` - For unique IDs

### Step 6: Test Locally
```bash
npm start
```

Test the chat:
```bash
curl -X POST http://localhost:5173/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello",
    "userId": "test-user-123",
    "conversationId": null
  }'
```

## 📝 API Changes

### Old API (File-Based)
```bash
# Send message without userId
POST /api/chat
{
  "message": "hello",
  "imageUrl": null,
  "sessionId": "session_123"  // Auto-generated
}

# Response
{
  "reply": "...",
  "sessionId": "session_123"
}
```

### New API (Database)
```bash
# Send message with userId (REQUIRED)
POST /api/chat
{
  "message": "hello",
  "imageUrl": null,
  "userId": "user@example.com",  // REQUIRED: unique user identifier
  "conversationId": null  // Optional: auto-create if not provided
}

# Response
{
  "reply": "...",
  "conversationId": "conv_...",
  "userId": "user@example.com"
}
```

## 🆕 New API Endpoints

### Create Conversation
```bash
POST /api/conversations
{
  "userId": "user@example.com",
  "title": "Project Discussion"
}
```

### Get All User Conversations
```bash
GET /api/users/{userId}/conversations?limit=50
```

### Get Conversation with Messages
```bash
GET /api/conversations/{conversationId}
```

### Get Conversation Messages Only
```bash
GET /api/conversations/{conversationId}/messages?limit=20
```

### Delete Conversation
```bash
DELETE /api/conversations/{conversationId}
```

### Clear Conversation Messages
```bash
POST /api/conversations/{conversationId}/clear
```

### Get Database Stats
```bash
GET /api/stats
```

Returns:
```json
{
  "totalUsers": 42,
  "totalConversations": 156,
  "totalMessages": 3241
}
```

## 🔑 Data Structure

### Users Table
```
- id (PRIMARY KEY)
- user_id (UNIQUE)
- name (optional)
- email (optional)
- created_at
- updated_at
```

### Conversations Table
```
- id (PRIMARY KEY)
- conversation_id (UNIQUE)
- user_id (FOREIGN KEY)
- title
- created_at
- updated_at
```

### Messages Table
```
- id (PRIMARY KEY)
- message_id (UNIQUE)
- conversation_id (FOREIGN KEY)
- role ('user' or 'assistant')
- content (TEXT)
- timestamp
```

## 🛠️ ConversationService API

Available functions in `conversationService.js`:

```javascript
// Users
await ConversationService.getOrCreateUser(userId, userData)

// Conversations
await ConversationService.createConversation(userId, title)
await ConversationService.getConversation(conversationId)
await ConversationService.getConversationFull(conversationId, messageLimit)
await ConversationService.getUserConversations(userId, limit)
await ConversationService.deleteConversation(conversationId)
await ConversationService.clearConversationMessages(conversationId)

// Messages
await ConversationService.addMessage(conversationId, role, content)
await ConversationService.getConversationMessages(conversationId, limit)
await ConversationService.getLastMessages(conversationId, count)

// Stats
await ConversationService.getStats()
```

## 🚢 Deployment to Vercel

### Update Environment Variables
1. Go to Vercel project settings
2. Add/update Environment Variables:
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

### Deploy
```bash
git add .
git commit -m "Migrate to Supabase database"
git push
```

Vercel will auto-deploy. Check deployment logs for any errors.

## 📊 Migration from Old File Storage

### Migrating Existing Data (Optional)
If you have conversations in `data/conversations.json` and want to migrate them:

1. Create a migration script (see example below)
2. Run the script once
3. Verify data in Supabase
4. Delete `data/conversations.json` after verification

Example migration script:
```javascript
// migrate.js
import fs from 'fs';
import ConversationService from './conversationService.js';

async function migrate() {
  const data = JSON.parse(fs.readFileSync('data/conversations.json', 'utf8'));
  
  for (const [sessionId, session] of Object.entries(data)) {
    const userId = session.userId || sessionId;
    
    // Create user
    await ConversationService.getOrCreateUser(userId);
    
    // Create conversation
    const conv = await ConversationService.createConversation(userId);
    
    // Add messages
    for (const msg of session.messages) {
      await ConversationService.addMessage(
        conv.conversation_id,
        msg.role === 'model' ? 'assistant' : msg.role,
        msg.content
      );
    }
    
    console.log(`✅ Migrated ${sessionId} (${session.messages.length} messages)`);
  }
  
  console.log('✅ Migration complete!');
}

migrate().catch(console.error);
```

Run it:
```bash
node migrate.js
```

## ✅ Verification Checklist

- [ ] Supabase project created
- [ ] Environment variables set
- [ ] Database tables created via SQL Editor
- [ ] Dependencies installed (`npm install`)
- [ ] Server starts without errors (`npm start`)
- [ ] Chat endpoint works with `userId`
- [ ] Messages appear in Supabase dashboard
- [ ] All new API endpoints respond
- [ ] Stats endpoint shows positive numbers
- [ ] Deployed to Vercel successfully

## 🐛 Troubleshooting

### "Supabase credentials missing"
- Check `.env.local` or environment variables
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set

### "Failed to fetch conversation: undefined is not a function"
- Make sure database tables exist in Supabase
- Run SUPABASE_SETUP.sql again

### "userId is required"
- The new API requires `userId` in chat requests
- Update your frontend to send `userId`

### "Connection timeout"
- Check internet connection
- Verify Supabase project is running
- Check if Supabase region is correct

### "Row Level Security (RLS) error"
- RLS is enabled by default for security
- Make sure policies are set correctly
- Or disable RLS for development (not recommended for production)

## 📚 References

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## ❓ Questions?

Check the following:
1. Console logs for detailed error messages
2. Supabase dashboard > Logs for database errors
3. Vercel logs for deployment issues
