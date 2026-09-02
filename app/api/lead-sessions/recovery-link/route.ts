import { NextRequest, NextResponse } from "next/server";

import { getLeadSessionByRecoveryToken } from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await getLeadSessionByRecoveryToken(recoveryToken);
    const recoveryUrl = new URL("/api/lead-sessions/recover", request.url);
    recoveryUrl.searchParams.set("token", recoveryToken);
    return NextResponse.json(
      { recoveryUrl: recoveryUrl.toString() },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
}
