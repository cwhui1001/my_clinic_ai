import "server-only";

import { encryptProtectedContent } from "@/src/server/crypto/protected-content";

export function encryptLeadContext(plaintext: string | undefined) {
  if (!plaintext) return null;
  return encryptProtectedContent(plaintext);
}
