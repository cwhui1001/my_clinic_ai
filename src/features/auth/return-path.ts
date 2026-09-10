const PATIENT_RETURN_PATH = /^\/patient\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:#escalation-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/i;

export function parsePatientReturnPath(value: unknown) {
  return typeof value === "string" && PATIENT_RETURN_PATH.test(value) ? value : null;
}
