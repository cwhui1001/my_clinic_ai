export function buildResponseNotificationPayload(patientSessionId: string, escalationId: string) {
  const conversationPath = `/patient/sessions/${patientSessionId}#escalation-${escalationId}`;
  return {
    title: "Nightingale",
    body: "A clinic response is available in your secure conversation.",
    url: `/login?next=${encodeURIComponent(conversationPath)}`,
  } as const;
}
