import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  LEAD_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  LEAD_CONTEXT_ENCRYPTION_KEY: z.string().min(1),
  RATE_LIMIT_HMAC_KEY: z.string().min(32),
});

export function getServerEnv() {
  const env = serverEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    LEAD_SESSION_TTL_DAYS: process.env.LEAD_SESSION_TTL_DAYS,
    LEAD_CONTEXT_ENCRYPTION_KEY: process.env.LEAD_CONTEXT_ENCRYPTION_KEY,
    RATE_LIMIT_HMAC_KEY: process.env.RATE_LIMIT_HMAC_KEY,
  });

  const encryptionKey = Buffer.from(env.LEAD_CONTEXT_ENCRYPTION_KEY, "base64");
  if (encryptionKey.byteLength !== 32) {
    throw new Error("LEAD_CONTEXT_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  return env;
}
