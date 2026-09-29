import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getServerEnv, requireSupabasePublicEnv } from "@/lib/env";

export function createAdminClient() {
  const { url } = requireSupabasePublicEnv();
  const serviceRoleKey = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this administrative operation.");
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
