import { NextRequest, NextResponse } from "next/server";

import {
  createGuestTurn,
  getGuestThread,
  GuestChatError,
} from "@/src/features/guest-chat/service";
import { guestMessageRequestSchema } from "@/src/features/guest-chat/schema";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { writeAuditLog } from "@/src/server/logging/audit";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 8_192;

function errorResponse(error: unknown) {
  if (error instanceof GuestChatError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "turn_in_progress" || error.code === "invalid_state"
          ? 409
          : error.code === "not_found"
            ? 404
            : 503;
    return NextResponse.json(
      { error: error.code },
      { status, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: "unexpected_error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) return errorResponse(new GuestChatError("not_found"));

  try {
    const thread = await getGuestThread(recoveryToken);
    return NextResponse.json({ thread }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) return errorResponse(new GuestChatError("not_found"));

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "payload_too_large" },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "invalid_json" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = guestMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const reply = await createGuestTurn(recoveryToken, parsed.data);
    writeAuditLog({
      action: "guest_message.complete",
      outcome: "success",
      resourceId: reply.guestMessage.id,
    });
    return NextResponse.json({ reply }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    writeAuditLog({
      action: "guest_message.complete",
      outcome: "failure",
      errorCode: error instanceof GuestChatError ? error.code : "unexpected_error",
    });
    return errorResponse(error);
  }
}
