/**
 * Supabase Database Client
 * Handles all database connections and operations for the OXY AI chat system
 * 
 * Required environment variables:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_ANON_KEY: Your Supabase anonymous key
 */

import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "❌ [DB] Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_ANON_KEY"
  );
  throw new Error("Supabase configuration missing");
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("✅ [DB] Supabase client initialized");

export default supabase;
