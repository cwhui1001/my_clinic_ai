import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { getServerEnv } from "@/src/config/server-env";

export const GUEST_SESSION_COOKIE = "nightingale_guest";

export function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashRequestFingerprint(ip: string, userAgent: string) {
  return createHmac("sha256", getServerEnv().RATE_LIMIT_HMAC_KEY)
    .update(`${ip}\u0000${userAgent}`, "utf8")
    .digest("hex");
}
