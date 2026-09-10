import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authCredentialsSchema } from "@/src/features/auth/schema";
import { parsePatientReturnPath } from "@/src/features/auth/return-path";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";

const requestSchema = authCredentialsSchema.extend({ next: z.string().max(200) }).strict();
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (!body.success) {
    return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  }

  const parsed = requestSchema.safeParse(body.data);
  const next = parsed.success ? parsePatientReturnPath(parsed.data.next) : null;
  if (!parsed.success || !next) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user || (!data.user.email_confirmed_at && !data.user.phone_confirmed_at)) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    writeAuditLog({ action: "auth.patient_return", outcome: "success", resourceId: data.user.id });
    return NextResponse.json({ next }, { headers: NO_STORE_HEADERS });
  } catch {
    writeAuditLog({ action: "auth.patient_return", outcome: "failure", errorCode: "login_failed" });
    return NextResponse.json({ error: "login_failed" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
