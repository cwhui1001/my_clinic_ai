import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EscalationActions } from "@/app/components/escalation-actions";
import { getEscalationReview } from "@/src/features/staff/service";
import { StaffAccessError } from "@/src/features/staff/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export default async function EscalationReviewPage({ params }: { params: Promise<{ escalationId: string }> }) {
  const { escalationId } = await params;
  if (!UUID_PATTERN.test(escalationId)) notFound();
  let review;
  try {
    review = await getEscalationReview(escalationId);
  } catch (error) {
    if (error instanceof StaffAccessError && error.code === "unauthenticated") redirect("/staff/login");
    if (error instanceof StaffAccessError && error.code === "forbidden") notFound();
    throw error;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link className="text-sm font-semibold text-teal-800 underline" href="/staff">Back to queue</Link>
        <header className="mt-5 rounded-3xl bg-slate-950 p-6 text-white shadow-lg sm:p-8">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold uppercase text-red-800">{review.riskLevel} risk</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold uppercase">{review.status}</span></div>
          <h1 className="mt-4 text-3xl font-semibold">Patient {review.patientReference}</h1>
          <p className="mt-2 text-sm text-slate-300">{review.clinicName} · Sent {formatDate(review.sentAt)} · Expected by {formatDate(review.responseExpectedBy)}</p>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-5">
            <Panel title="Triage summary"><ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">{review.summary.map((item) => <li key={item}>{item}</li>)}</ul></Panel>
            <Panel title="Triggering message"><blockquote className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-800">{review.triggerMessage}</blockquote><p className="mt-3 text-xs text-slate-500">Risk rationale: {review.riskReason} · {review.riskConfidence} confidence</p></Panel>
            <Panel title="Point-in-time Patient Profile">
              {review.profileSnapshot.some((fact) => fact.contradictionStatus === "open") ? <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert"><strong>Safety-sensitive contradictions need clarification.</strong> Earlier and later evidence is preserved below; do not use last-write-wins.</div> : null}
              {review.profileSnapshot.length ? <div className="grid gap-3 sm:grid-cols-2">{review.profileSnapshot.map((fact) => <div key={fact.revisionId} className={`rounded-xl border p-3 ${fact.contradictionStatus === "open" ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}><p className="text-xs font-bold uppercase text-slate-500">{fact.kind.replaceAll("_", " ")} · {fact.status}</p><p className="mt-2 text-sm text-slate-800">{displayValue(fact.value)}</p>{fact.contradictionStatus === "open" ? <p className="mt-2 text-xs font-bold text-amber-900">Open: {fact.conflicts.map((conflict) => conflict.kind.replaceAll("_", " ")).join(", ")}</p> : null}<details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Revision history ({fact.history.length})</summary><ol className="mt-2 space-y-1">{fact.history.map((revision) => <li key={revision.revisionId}>{revision.status} · {formatDate(revision.updatedAt)} · source {revision.sourceIntegrity}</li>)}</ol></details><p className="mt-2 text-xs text-slate-400">Revision {fact.revisionId.slice(0, 8)} · source {fact.sourceIntegrity}</p></div>)}</div> : <p className="text-sm text-slate-500">No structured facts existed at send time.</p>}
            </Panel>
            <Panel title="Clinician responses">{review.responses.length ? <div className="space-y-3">{review.responses.map((response) => <article key={response.id} className="rounded-xl bg-teal-50 p-4"><p className="text-xs font-bold uppercase text-teal-800">{response.authorRole} · {formatDate(response.createdAt)}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{response.content}</p></article>)}</div> : <p className="text-sm text-slate-500">No clinician response has been recorded yet.</p>}</Panel>
          </div>

          <aside className="space-y-5">
            <EscalationActions escalationId={review.id} status={review.status} canRespond={review.canRespond} />
            <Panel title="Acquisition context"><Definition label="Channel" value={review.attribution.sourceChannel.replaceAll("_", " ")} /><Definition label="Campaign" value={review.attribution.campaignId ?? "None"} /><Definition label="Creative" value={review.attribution.creative ?? "None"} /><Definition label="Original identity" value={review.attribution.acquisitionIdentityLevel.replaceAll("_", " ")} /><Definition label="Current identity" value={review.attribution.identityVerified ? `Verified via ${review.attribution.authenticationMethod.replaceAll("_", " ")}` : "Unverified"} /><Definition label="Landing" value={formatDate(review.attribution.landingTimestamp)} /></Panel>
            <Panel title="Provenance"><p className="text-sm text-slate-600">{review.provenance.length} normalized source pointer{review.provenance.length === 1 ? "" : "s"} preserve the trigger and profile evidence.</p><ul className="mt-3 space-y-2 text-xs text-slate-500">{review.provenance.map((item, index) => <li key={`${item.purpose}-${index}`}>{item.purpose.replaceAll("_", " ")} · {(item.messageId ?? item.memoryRevisionId)?.slice(0, 8)}</li>)}</ul></Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold text-slate-950">{title}</h2>{children}</section>; }
function Definition({ label, value }: { label: string; value: string }) { return <div className="mb-3"><dt className="text-xs font-bold uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm capitalize text-slate-800">{value}</dd></div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function displayValue(value: string) { try { const parsed = JSON.parse(value) as Record<string, unknown>; return Object.values(parsed).filter((part) => typeof part === "string" && part).join(" · ") || value; } catch { return value; } }
