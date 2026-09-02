import "server-only";

type AuditEntry = {
  action: string;
  outcome: "success" | "failure";
  resourceId?: string;
  errorCode?: string;
};

export function writeAuditLog(entry: AuditEntry) {
  // Allowlisted fields only. Never pass request bodies, message/context text,
  // email, phone, names, identifiers, or exception messages here.
  console.info(
    JSON.stringify({
      event: "audit",
      action: entry.action,
      outcome: entry.outcome,
      resource_id: entry.resourceId,
      error_code: entry.errorCode,
      occurred_at: new Date().toISOString(),
    }),
  );
}
