import { NextResponse } from "next/server";

import { EscalationError, queuePatientEscalation } from "@/src/features/escalation/service";
import { writeAuditLog } from "@/src/server/logging/audit";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(_request: Request, context: { params: Promise<{ escalationId: string }> }) {
  const { escalationId } = await context.params;
  if (!UUID_PATTERN.test(escalationId)) return errorResponse(new EscalationError("not_found"));

  try {
    const escalation = await queuePatientEscalation(escalationId);
    return NextResponse.json({ escalation }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    writeAuditLog({
      action: "escalation.queue",
      outcome: "failure",
      resourceId: escalationId,
      errorCode: error instanceof EscalationError ? error.code : "unexpected_error",
    });
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof EscalationError) {
    const status = error.code === "unauthenticated" ? 401 : error.code === "not_found" ? 404 : error.code === "database_error" ? 503 : 409;
    return NextResponse.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ error: "unexpected_error" }, { status: 500, headers: NO_STORE_HEADERS });
}
