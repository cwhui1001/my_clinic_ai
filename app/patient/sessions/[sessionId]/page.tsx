import { notFound, redirect } from "next/navigation";

import { SignoutButton } from "@/app/components/signout-button";
import { getPatientSessionView, PatientSessionError } from "@/src/features/patient-sessions/service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PatientSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!UUID_PATTERN.test(sessionId)) notFound();

  let session;
  try {
    session = await getPatientSessionView(sessionId);
  } catch (error) {
    if (error instanceof PatientSessionError && error.code === "unauthenticated") redirect("/signup?mode=login");
    if (error instanceof PatientSessionError && error.code === "not_found") notFound();
    throw error;
  }

  return (
    <main className="page-shell items-start">
      <section className="w-full max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Patient session · {session.clinic.name}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Your guest context was preserved</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">You do not need to repeat yourself. This verified patient session retains the conversation and how you reached the clinic.</p>
          </div>
          <SignoutButton />
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          <Summary label="Signed in as" value={session.patientEmail} />
          <Summary label="Source" value={session.attribution.sourceChannel.replaceAll("_", " ")} />
          <Summary label="Consent recorded" value={formatDate(session.consentedAt)} />
        </div>

        {session.preloadedContext ? (
          <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-950">
            <strong>Preserved referral context:</strong> {session.preloadedContext}
          </div>
        ) : null}

        <section className="mt-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <header className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <h2 className="font-semibold text-slate-950">Preserved conversation</h2>
            <p className="mt-1 text-xs text-slate-500">Visible here only after verified authentication, ownership checks, and consent.</p>
          </header>
          <div className="space-y-4 bg-slate-50/70 px-5 py-6 sm:px-6">
            {session.messages.length ? session.messages.map((message) => {
              const isPatient = message.actor === "guest";
              return (
                <div className={`flex ${isPatient ? "justify-end" : "justify-start"}`} key={message.id}>
                  <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${isPatient ? "rounded-br-md bg-teal-700 text-white" : "rounded-bl-md bg-white text-slate-800"}`}>
                    {message.content}
                  </div>
                </div>
              );
            }) : <p className="text-sm text-slate-500">No completed guest messages were recorded.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 break-words text-sm font-semibold capitalize text-slate-900">{value}</p></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
