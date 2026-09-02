import { NextRequest, NextResponse } from "next/server";

import { acquisitionRequestSchema } from "@/src/features/attribution/schema";
import {
  createLeadSession,
  getLeadSessionByRecoveryToken,
  LeadSessionError,
} from "@/src/features/lead-sessions/service";
import {
  GUEST_SESSION_COOKIE,
  hashRequestFingerprint,
} from "@/src/server/crypto/guest-token";
import { writeAuditLog } from "@/src/server/logging/audit";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 16_384;

function getRequestFingerprint(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return hashRequestFingerprint(ip, userAgent);
}

function errorResponse(error: unknown) {
  if (error instanceof LeadSessionError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "clinic_not_found" || error.code === "not_found"
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

export async function POST(request: NextRequest) {
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

    const parsed = acquisitionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid_request",
          issues: parsed.error.issues.map((issue) => issue.path.join(".")),
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { session, recoveryToken } = await createLeadSession(parsed.data, {
      fingerprintHash: getRequestFingerprint(request),
      referrer: request.headers.get("referer"),
    });

    const response = NextResponse.json(
      { session },
      { status: 201, headers: NO_STORE_HEADERS },
    );
    response.cookies.set(GUEST_SESSION_COOKIE, recoveryToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expiresAt),
    });

    writeAuditLog({
      action: "lead_session.create",
      outcome: "success",
      resourceId: session.id,
    });
    return response;
  } catch (error) {
    writeAuditLog({
      action: "lead_session.create",
      outcome: "failure",
      errorCode:
        error instanceof LeadSessionError ? error.code : "unexpected_error",
    });
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const session = await getLeadSessionByRecoveryToken(recoveryToken);
    return NextResponse.json({ session }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
