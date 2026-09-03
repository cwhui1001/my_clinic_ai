import { NextRequest, NextResponse } from "next/server";

import { StaffAccessError } from "@/src/features/staff/auth";
import { clinicianResponseSchema } from "@/src/features/staff/schema";
import { respondToEscalation } from "@/src/features/staff/service";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: { params: Promise<{ escalationId: string }> }) {
  const { escalationId } = await context.params;
  if (!UUID_PATTERN.test(escalationId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE_HEADERS });
  const body = await readJsonBody(request);
  if (!body.success) return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  const parsed = clinicianResponseSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });

  try {
    const responseId = await respondToEscalation(escalationId, parsed.data.content);
    return NextResponse.json({ responseId }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    writeAuditLog({ action: "escalation.respond", outcome: "failure", resourceId: escalationId, errorCode: error instanceof StaffAccessError ? error.code : "unexpected_error" });
    if (error instanceof StaffAccessError) {
      const status = error.code === "unauthenticated" ? 401 : error.code === "forbidden" ? 403 : 503;
      return NextResponse.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ error: "unexpected_error" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
