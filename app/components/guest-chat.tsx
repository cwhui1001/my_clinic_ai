"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import type {
  GuestMessageDto,
  GuestReplyDto,
  GuestThreadDto,
} from "@/src/types/guest-chat";

type LoadStatus = "loading" | "ready" | "missing" | "error";

const QUICK_PROMPTS = [
  "What services does the clinic offer?",
  "What are the clinic hours?",
  "Are you a real doctor?",
];

export function GuestChat() {
  const [thread, setThread] = useState<GuestThreadDto | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const [showContinuation, setShowContinuation] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/guest/messages", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("lookup_failed");
        const payload = (await response.json()) as { thread: GuestThreadDto };
        return payload.thread;
      })
      .then((value) => {
        if (!active) return;
        setThread(value);
        setStatus(value ? "ready" : "missing");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread?.messages, pending]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !thread || pending) return;

    const clientMessageId = crypto.randomUUID();
    const optimistic: GuestMessageDto = {
      id: clientMessageId,
      actor: "guest",
      status: "received",
      content: message,
      sequenceNumber: Number.MAX_SAFE_INTEGER,
      requiresSecureContinue: false,
      createdAt: new Date().toISOString(),
    };
    setThread({ ...thread, messages: [...thread.messages, optimistic] });
    setDraft("");
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/guest/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId, message }),
      });
      const payload = (await response.json()) as {
        reply?: GuestReplyDto;
        error?: string;
      };
      if (!response.ok || !payload.reply) {
        throw new Error(userFacingError(payload.error));
      }

      const reply = payload.reply;
      setThread((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages.filter((item) => item.id !== clientMessageId),
                reply.guestMessage,
                reply.assistantMessage,
              ].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
            }
          : current,
      );
      if (reply.assistantMessage.requiresSecureContinue) {
        setShowContinuation(true);
      }
    } catch (reason) {
      setThread((current) =>
        current
          ? {
              ...current,
              messages: current.messages.filter((item) => item.id !== clientMessageId),
            }
          : current,
      );
      setDraft(message);
      setError(reason instanceof Error ? reason.message : "Unable to send your message.");
    } finally {
      setPending(false);
    }
  }

  async function copyRecoveryLink() {
    setError(null);
    try {
      const response = await fetch("/api/lead-sessions/recovery-link", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        recoveryUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.recoveryUrl) throw new Error("Unable to create the link.");
      setRecoveryUrl(payload.recoveryUrl);
      if (navigator.clipboard) await navigator.clipboard.writeText(payload.recoveryUrl);
    } catch {
      setError("The recovery link could not be copied. Please try again.");
    }
  }

  if (status === "loading") {
    return <p className="text-sm text-slate-600">Recovering your secure session…</p>;
  }

  if (status !== "ready" || !thread) {
    return (
      <div className="space-y-4">
        <p className="text-slate-700">
          {status === "missing"
            ? "No active guest session was found."
            : "The session could not be loaded."}
        </p>
        <Link className="primary-button inline-flex" href="/">
          Return to entry page
        </Link>
      </div>
    );
  }

  const { session, messages } = thread;
  const opening = session.openingStrategy;

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-950">Nightingale AI</p>
            <p className="text-xs text-slate-500">Guest assistant · {session.clinic.name}</p>
          </div>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={copyRecoveryLink}
            type="button"
          >
            Copy recovery link
          </button>
        </div>
        {recoveryUrl ? (
          <p className="mt-2 break-all rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Recovery link copied. Keep it private: {recoveryUrl}
          </p>
        ) : null}
      </header>

      <div className="h-[min(58vh,34rem)] space-y-4 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6">
        <MessageBubble
          message={{
            id: "opening",
            actor: "assistant",
            status: "completed",
            content: `${opening?.headline ?? "How can we help?"}\n${opening?.prompt ?? "Ask a general question before sharing anything personal."}`,
            sequenceNumber: 0,
            requiresSecureContinue: false,
            createdAt: session.attribution.landingTimestamp,
          }}
        />

        {session.preloadedContext ? (
          <div className="mx-auto max-w-xl rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-900">
            <strong>Preloaded private context:</strong> {session.preloadedContext}
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setDraft(prompt)}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:border-teal-300 hover:text-teal-800"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {pending ? (
          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
            Nightingale is preparing a safe response…
          </div>
        ) : null}

        {showContinuation ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Ready for secure human follow-up?</p>
            <p className="mt-1 leading-6">
              The next phase will verify your identity and ask for consent before sharing
              any protected guest context with {session.clinic.name}.
            </p>
            <button
              className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white"
              type="button"
              onClick={() => setShowContinuation(false)}
            >
              Not now
            </button>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form onSubmit={sendMessage} className="border-t border-slate-100 p-4 sm:p-6">
        <label className="sr-only" htmlFor="guest-message">
          Message Nightingale AI
        </label>
        <div className="flex items-end gap-3">
          <textarea
            id="guest-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="field-control min-h-12 max-h-36 resize-y"
            maxLength={2000}
            placeholder="Ask about services, hours, availability, or general information…"
            rows={2}
          />
          <button
            className="primary-button mb-0.5 !w-auto shrink-0"
            type="submit"
            disabled={pending || !draft.trim()}
          >
            Send
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <p className="mt-3 text-xs font-medium leading-5 text-red-700">
          If this is an emergency, exit Nightingale and dial 999 for Emergency Services.
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Nightingale AI provides general, non-diagnostic information. Guest messages are
          encrypted and are not visible to clinic staff before consent.
        </p>
      </form>

      <details className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-6">
        <summary className="cursor-pointer font-semibold text-slate-700">
          Acquisition details
        </summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <Detail label="Source" value={session.attribution.sourceChannel} />
          <Detail label="Identity" value={session.attribution.identityLevel} />
          <Detail label="Campaign" value={session.attribution.campaignId ?? "—"} />
          <Detail label="Platform" value={session.attribution.socialPlatform ?? "—"} />
        </dl>
      </details>
    </div>
  );
}

function MessageBubble({ message }: { message: GuestMessageDto }) {
  const guest = message.actor === "guest";
  return (
    <div className={`flex ${guest ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
          guest
            ? "rounded-br-md bg-teal-700 text-white"
            : "rounded-bl-md bg-white text-slate-800"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-700">{value}</dd>
    </div>
  );
}

function userFacingError(code?: string) {
  if (code === "rate_limited") return "Too many messages were sent. Try again later.";
  if (code === "turn_in_progress") return "Please wait for the current response.";
  if (code === "not_found") return "This guest session has expired or is unavailable.";
  return "Your message could not be sent. Please try again.";
}
