import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/src/config/server-env";
import type { Database } from "@/src/types/database";

export function createAdminClient() {
  const env = getServerEnv();

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
