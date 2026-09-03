import { NextResponse } from "next/server";

import { acknowledgeEscalation } from "@/src/features/staff/service";
import { StaffAccessError } from "@/src/features/staff/auth";
import { writeAuditLog } from "@/src/server/logging/audit";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ escalationId: string }> }) {
  const { escalationId } = await context.params;
  if (!UUID_PATTERN.test(escalationId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE_HEADERS });
  try {
    const status = await acknowledgeEscalation(escalationId);
    return NextResponse.json({ status }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    writeAuditLog({ action: "escalation.acknowledge", outcome: "failure", resourceId: escalationId, errorCode: error instanceof StaffAccessError ? error.code : "unexpected_error" });
    return staffError(error);
  }
}

function staffError(error: unknown) {
  if (error instanceof StaffAccessError) {
    const status = error.code === "unauthenticated" ? 401 : error.code === "forbidden" ? 403 : 503;
    return NextResponse.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ error: "unexpected_error" }, { status: 500, headers: NO_STORE_HEADERS });
}
