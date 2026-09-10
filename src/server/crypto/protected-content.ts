import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { getServerEnv } from "@/src/config/server-env";

const FORMAT_VERSION = "v1";
export const SAFETY_RESERVATION_PLACEHOLDER = "[PENDING_SAFETY_PIPELINE]";

function getEncryptionKey() {
  return Buffer.from(getServerEnv().LEAD_CONTEXT_ENCRYPTION_KEY, "base64");
}

export function hashProtectedContent(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function encryptProtectedContent(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [FORMAT_VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptProtectedContent(payload: string) {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] = payload.split(".");
  if (
    version !== FORMAT_VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length > 0
  ) {
    throw new Error("Unsupported protected-content format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
