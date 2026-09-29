"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { requireSupabasePublicEnv } from "@/lib/env";

let browserClient: SupabaseClient<Database> | undefined;

export function createClient() {
  if (browserClient) return browserClient;
  const { url, anonKey } = requireSupabasePublicEnv();
  browserClient = createBrowserClient<Database>(url, anonKey);
  return browserClient;
}
