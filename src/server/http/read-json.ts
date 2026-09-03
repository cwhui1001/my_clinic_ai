import "server-only";

import type { NextRequest } from "next/server";

export type JsonBodyResult =
  | { success: true; data: unknown }
  | { success: false; error: "invalid_json" | "unsupported_media_type" | "payload_too_large"; status: 400 | 413 | 415 };

export async function readJsonBody(request: NextRequest, maxBytes = 8_192): Promise<JsonBodyResult> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { success: false, error: "unsupported_media_type", status: 415 };
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { success: false, error: "payload_too_large", status: 413 };
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    return { success: false, error: "payload_too_large", status: 413 };
  }

  try {
    return { success: true, data: JSON.parse(rawBody) as unknown };
  } catch {
    return { success: false, error: "invalid_json", status: 400 };
  }
}
