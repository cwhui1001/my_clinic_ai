const SAFE_TOKEN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const SAFE_RESOURCE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/i;

export type SafeAuditInput = {
  action: string;
  outcome: "success" | "failure";
  resourceId?: string;
  errorCode?: string;
};

export function sanitizeAuditEntry(entry: SafeAuditInput) {
  return {
    event: "audit" as const,
    action: safeToken(entry.action),
    outcome: entry.outcome,
    resource_id: entry.resourceId && SAFE_RESOURCE_ID.test(entry.resourceId)
      ? entry.resourceId
      : undefined,
    error_code: entry.errorCode ? safeToken(entry.errorCode) : undefined,
  };
}

function safeToken(value: string) {
  return SAFE_TOKEN.test(value) ? value : "invalid";
}
