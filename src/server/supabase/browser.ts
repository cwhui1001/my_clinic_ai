"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/src/config/public-env";
import type { Database } from "@/src/types/database";

export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
