import "server-only";

import { createCipheriv, randomBytes } from "node:crypto";

import { getServerEnv } from "@/src/config/server-env";

export function encryptLeadContext(plaintext: string | undefined) {
  if (!plaintext) return null;

  const key = Buffer.from(getServerEnv().LEAD_CONTEXT_ENCRYPTION_KEY, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return ["v1", iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}
