import { NextRequest, NextResponse } from "next/server";

import { authCredentialsSchema } from "@/src/features/auth/schema";
import {
  getLeadSessionByRecoveryToken,
  markLeadAuthStarted,
} from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { writeAuditLog } from "@/src/server/logging/audit";
import { readJsonBody } from "@/src/server/http/read-json";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) {
    return NextResponse.json({ error: "guest_session_required" }, { status: 404 });
  }

  try {
    await getLeadSessionByRecoveryToken(recoveryToken);
    const body = await readJsonBody(request);
    if (!body.success) {
      return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
    }
    const parsed = authCredentialsSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    await markLeadAuthStarted(recoveryToken);
    writeAuditLog({
      action: "auth.login",
      outcome: "success",
      resourceId: data.user.id,
    });
    return NextResponse.json({ next: "/consent" }, { headers: NO_STORE_HEADERS });
  } catch {
    writeAuditLog({ action: "auth.login", outcome: "failure", errorCode: "login_failed" });
    return NextResponse.json(
      { error: "login_failed" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
