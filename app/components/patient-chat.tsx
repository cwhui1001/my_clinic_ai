"use client";

import { FormEvent, useRef, useState } from "react";

import type { PatientMessageDto, PatientReplyDto } from "@/src/types/patient-chat";

export function PatientChat({
  sessionId,
  initialMessages,
}: {
  sessionId: string;
  initialMessages: PatientMessageDto[];
}) {
  const [messages, setMessages] = useState(initialMessages);
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
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== clientMessageId));
      setDraft(content);
      setError(patientError(reason instanceof Error ? reason.message : "request_failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
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
            placeholder="Tell Nightingale what you would like the clinic to understand..."
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
  );
}

function PatientMessage({ message }: { message: PatientMessageDto }) {
  const fromPatient = message.actor === "patient" || message.actor === "guest";
  return (
    <div>
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
