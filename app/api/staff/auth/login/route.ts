import { NextRequest, NextResponse } from "next/server";

import { authCredentialsSchema } from "@/src/features/auth/schema";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (!body.success) return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  const parsed = authCredentialsSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_credentials" }, { status: 400, headers: NO_STORE_HEADERS });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user?.email_confirmed_at) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("clinic_memberships")
    .select("id")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership) {
    await supabase.auth.signOut();
    writeAuditLog({ action: "staff.login", outcome: "failure", resourceId: data.user.id, errorCode: "staff_access_denied" });
    return NextResponse.json({ error: "staff_access_denied" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  writeAuditLog({ action: "staff.login", outcome: "success", resourceId: membership.id });
  return NextResponse.json({ next: "/staff" }, { headers: NO_STORE_HEADERS });
}
