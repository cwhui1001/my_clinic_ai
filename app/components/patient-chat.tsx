"use client";

import { FormEvent, useRef, useState } from "react";

import type { PatientMessageDto, PatientReplyDto } from "@/src/types/patient-chat";
import type { MemoryItemDto } from "@/src/types/memory";
import type { PatientEscalationDto } from "@/src/types/escalation";

export function PatientChat({
  sessionId,
  continuedFromGuest,
  initialMessages,
  initialMemory,
  initialEscalations,
}: {
  sessionId: string;
  continuedFromGuest: boolean;
  initialMessages: PatientMessageDto[];
  initialMemory: MemoryItemDto[];
  initialEscalations: PatientEscalationDto[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [memory, setMemory] = useState(initialMemory);
  const [escalations, setEscalations] = useState(initialEscalations);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;

    const clientMessageId = crypto.randomUUID();
    const optimistic: PatientMessageDto = {
      id: clientMessageId,
      actor: "patient",
      status: "received",
      content,
      createdAt: new Date().toISOString(),
      risk: null,
      citations: [],
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/patient/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId, message: content }),
      });
      const payload = (await response.json()) as { reply?: PatientReplyDto; error?: string };
      if (!response.ok || !payload.reply) throw new Error(payload.error || "request_failed");
      setMessages((current) => [
        ...current.filter((message) => message.id !== clientMessageId),
        payload.reply!.patientMessage,
        payload.reply!.assistantMessage,
      ]);
      setMemory(payload.reply.memory);
      setEscalations(payload.reply.escalations);
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== clientMessageId));
      setDraft(content);
      setError(patientError(reason instanceof Error ? reason.message : "request_failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-7 space-y-5">
      <PatientProfile memory={memory} />
      <EscalationPanel escalations={escalations} onUpdate={(updated) => {
        setEscalations((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      }} />
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="font-semibold text-slate-950">Nightingale AI patient messenger</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Every new message is redacted and risk-checked before an AI response can be shown.
        </p>
      </header>

      <div className="h-[min(58vh,36rem)] space-y-4 overflow-y-auto bg-slate-50/70 px-5 py-6 sm:px-6" aria-live="polite">
        {messages.length ? messages.map((message) => <PatientMessage key={message.id} message={message} />) : <p className="text-sm text-slate-500">Your secure patient conversation starts here.</p>}
        {pending ? <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">Redacting and checking risk before responding...</div> : null}
      </div>

      <form ref={formRef} onSubmit={sendMessage} className="border-t border-slate-100 p-4 sm:p-6">
        <label className="sr-only" htmlFor="patient-message">Message Nightingale AI</label>
        <div className="flex items-end gap-3">
          <textarea
            className="field-control min-h-12 max-h-36 resize-y"
            id="patient-message"
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={continuedFromGuest ? "Add anything new or correct an earlier detail..." : "Tell Nightingale what you would like the clinic to understand..."}
            rows={2}
            value={draft}
          />
          <button className="primary-button mb-0.5 !w-auto shrink-0" disabled={pending || !draft.trim()} type="submit">Send</button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
        <p className="mt-3 text-xs font-semibold leading-5 text-red-700">
          If this is an emergency, exit Nightingale and dial 999 for Emergency Services.
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">Nightingale AI is non-diagnostic. Medium, High, or uncertain messages receive safety guidance instead of generated clinical advice.</p>
      </form>
      </section>
    </div>
  );
}

function EscalationPanel({
  escalations,
  onUpdate,
}: {
  escalations: PatientEscalationDto[];
  onUpdate: (escalation: PatientEscalationDto) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = escalations.find((item) => item.status === "required");
  const sent = escalations.find((item) => item.status !== "required");

  async function send() {
    if (!required || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/patient/escalations/${required.id}/send`, { method: "POST" });
      const payload = (await response.json()) as { escalation?: PatientEscalationDto; error?: string };
      if (!response.ok || !payload.escalation) throw new Error(payload.error || "request_failed");
      onUpdate(payload.escalation);
    } catch {
      setError("The handoff could not be sent securely. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!required && !sent) return null;
  return (
    <section id={sent ? `escalation-${sent.id}` : undefined} className={`rounded-3xl border p-5 shadow-sm sm:p-6 ${required?.riskLevel === "high" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`} aria-live="polite">
      {required ? (
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Human review recommended</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Send this concern to the clinic</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">A protected summary, your current profile, the triggering message, and their provenance will be shared with the clinic. You can keep chatting after sending.</p>
            {required.riskLevel === "high" ? <p className="mt-2 text-sm font-bold text-red-800">Do not wait for the clinic if this is an emergency. Exit Nightingale and dial 999 now.</p> : null}
          </div>
          <button className="primary-button !w-auto shrink-0" disabled={pending} onClick={send} type="button">{pending ? "Sending..." : "Send to Clinic"}</button>
        </div>
      ) : sent ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Sent to clinic · {sent.status}</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">Your protected handoff is in the care-team queue</h2>
          {sent.responseExpectedBy ? <p className="mt-2 text-sm leading-6 text-slate-700">Estimated response deadline recorded by the clinic: {formatMemoryDate(sent.responseExpectedBy)}. This is an expectation, not a guaranteed response time.</p> : <p className="mt-2 text-sm leading-6 text-slate-700">The handoff is recorded, but no response deadline is available. Return to this secure conversation to check for updates.</p>}
          {sent.responses.length ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4"><p className="text-xs font-bold uppercase text-emerald-800">Clinic response{sent.clinicianResponseAt ? ` · ${formatMemoryDate(sent.clinicianResponseAt)}` : ""}</p>{sent.responses.map((response) => <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800" key={response.id}>{response.content}</p>)}</div> : <p className="mt-3 text-xs text-slate-600">No clinician response has been recorded yet.</p>}
          {sent.riskLevel === "high" ? <p className="mt-2 text-sm font-bold text-red-800">For an emergency, do not wait for this response—exit Nightingale and dial 999.</p> : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
    </section>
  );
}

function PatientMessage({ message }: { message: PatientMessageDto }) {
  const fromPatient = message.actor === "patient" || message.actor === "guest";
  return (
    <div id={`message-${message.id}`}>
      <div className={`flex ${fromPatient ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${fromPatient ? "rounded-br-md bg-teal-700 text-white" : "rounded-bl-md bg-white text-slate-800"}`}>
          {message.content}
          {message.citations.length ? (
            <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
              <p className="font-semibold">Sources</p>
              <ol className="mt-1 space-y-1">
                {message.citations.map((citation) => (
                  <li key={citation.id}>
                    <a className="underline hover:text-teal-800" href={citation.url} rel="noreferrer" target="_blank">{citation.title} — {citation.publisher}</a>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </div>

      {message.risk ? (
        <div className={`mt-2 ml-auto max-w-xl rounded-xl border px-3 py-2 text-xs leading-5 ${riskStyle(message.risk.level)}`}>
          <p className="font-bold">Risk: {capitalize(message.risk.level)} · Confidence: {message.risk.confidence}</p>
          <p>{message.risk.reason}</p>
          {message.risk.escalationRequired ? <p className="mt-1 font-semibold">Clinical advice is paused. Send-to-Clinic follow-up is required.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function PatientProfile({ memory }: { memory: MemoryItemDto[] }) {
  return (
    <section className="rounded-3xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Living Memory</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">Patient Profile</h2>
        </div>
        <p className="max-w-sm text-xs leading-5 text-slate-500">Facts are extracted from your messages. Corrections add a new revision while preserving the original source.</p>
      </div>

      {memory.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {memory.map((item) => {
            const current = item.revisions.find((revision) => revision.id === item.currentRevisionId);
            if (!current) return null;
            return (
              <article key={item.id} className={`rounded-2xl border p-4 ${item.conflicts.some((conflict) => conflict.status === "open") ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{memoryLabel(item.kind)}</p>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${current.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{current.status}</span>
                </div>
                <p className="mt-2 break-words text-sm font-semibold text-slate-900">{displayMemoryValue(current.value)}</p>
                <p className="mt-2 text-xs text-slate-500">Updated {formatMemoryDate(current.updatedAt)} · {current.confidence} confidence</p>
                {item.conflicts.some((conflict) => conflict.status === "open") ? (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-white/70 p-3 text-xs leading-5 text-amber-950" role="alert">
                    <p className="font-bold">Needs clarification</p>
                    <p>Conflicting {item.conflicts.filter((conflict) => conflict.status === "open").map((conflict) => conflictLabel(conflict.kind)).join(", ")} evidence is preserved for clinic review.</p>
                  </div>
                ) : null}
                <details className="mt-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-teal-800">Provenance · {item.revisions.length} revision{item.revisions.length === 1 ? "" : "s"}</summary>
                  <ol className="mt-2 space-y-2 border-l border-teal-200 pl-3">
                    {item.revisions.map((revision) => (
                      <li key={revision.id}>
                        <span className="font-semibold">{revision.status}</span> · {formatMemoryDate(revision.updatedAt)} · {revision.sourceIntegrity === "verified" ? <a className="underline hover:text-teal-900" href={`#message-${revision.sourceMessageId}`}>verified source message</a> : <span className="font-semibold text-amber-800">source {revision.sourceIntegrity}</span>}
                        {revision.contradictionStatus === "open" ? <span className="ml-1 font-bold text-amber-800"> · contradiction open</span> : null}
                        {revision.sourceIntegrity !== "verified" ? <blockquote className="mt-1 rounded-lg bg-white p-2 text-slate-600">Immutable snapshot: {revision.sourceSnapshot}</blockquote> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              </article>
            );
          })}
        </div>
      ) : <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No profile facts have been captured yet. Explicitly share a main concern, symptom timeline, medication, or allergy to update this profile.</p>}
    </section>
  );
}

function memoryLabel(kind: MemoryItemDto["kind"]) {
  return kind.replaceAll("_", " ");
}

function conflictLabel(kind: MemoryItemDto["conflicts"][number]["kind"]) {
  if (kind === "allergy_presence") return "allergy";
  if (kind === "medication_status") return "medication status";
  return "dosage";
}

function displayMemoryValue(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.values(parsed).filter((part) => typeof part === "string" && part).join(" · ") || value;
  } catch {
    return value;
  }
}

function formatMemoryDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function riskStyle(level: "low" | "medium" | "high") {
  if (level === "high") return "border-red-300 bg-red-50 text-red-900";
  if (level === "medium") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function patientError(code: string) {
  if (code === "unauthenticated") return "Your secure session ended. Sign in again before sending.";
  if (code === "consent_required") return "Healthcare-sharing consent is required before this message can be processed.";
  if (code === "rate_limited") return "Too many messages were sent. Try again later.";
  if (code === "turn_in_progress") return "Please wait for the current safety check to finish.";
  if (code === "not_found") return "This patient session is unavailable.";
  return "The message could not be processed safely. Please try again.";
}
