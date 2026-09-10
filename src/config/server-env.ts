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

const openRouterEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default("openai/gpt-5.4-mini"),
  OPENROUTER_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(15000),
});

const webPushEnvSchema = z.object({
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(40),
  VAPID_PRIVATE_KEY: z.string().min(20),
  VAPID_SUBJECT: z.string().refine((value) => value.startsWith("mailto:") || value.startsWith("https://")),
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

export function getOpenRouterEnv() {
  return openRouterEnvSchema.parse({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OPENROUTER_REQUEST_TIMEOUT_MS: process.env.OPENROUTER_REQUEST_TIMEOUT_MS,
  });
}

export function getWebPushEnv() {
  const values = {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  };
  if (!values.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !values.VAPID_PRIVATE_KEY || !values.VAPID_SUBJECT) return null;
  return webPushEnvSchema.parse(values);
}
