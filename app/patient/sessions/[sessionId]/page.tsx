import { notFound, redirect } from "next/navigation";

import { SignoutButton } from "@/app/components/signout-button";
import { PatientChat } from "@/app/components/patient-chat";
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
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{session.continuedFromGuest ? "Your guest context was preserved" : "Your secure patient session"}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{session.continuedFromGuest ? "Your earlier concern and its original sources are already here. You do not need to repeat yourself—add only what is new or corrected." : "Use this verified session to share what you want the clinic to understand."}</p>
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

        {session.memoryBootstrapStatus !== "completed" ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="status">
            Your earlier messages remain visible, but their structured profile import is incomplete. You do not need to repeat them; retry secure continuation or ask the clinic to review the original messages.
          </div>
        ) : null}

        <PatientChat
          sessionId={session.id}
          continuedFromGuest={session.continuedFromGuest}
          initialMessages={session.messages}
          initialMemory={session.memory}
          initialEscalations={session.escalations}
        />
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
