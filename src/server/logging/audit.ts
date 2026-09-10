import "server-only";
import { sanitizeAuditEntry, type SafeAuditInput } from "@/src/server/logging/sanitize";

export function writeAuditLog(entry: SafeAuditInput) {
  // Allowlisted fields only. Never pass request bodies, message/context text,
  // email, phone, names, identifiers, or exception messages here.
  console.info(
    JSON.stringify({
      ...sanitizeAuditEntry(entry),
      occurred_at: new Date().toISOString(),
    }),
  );
}
