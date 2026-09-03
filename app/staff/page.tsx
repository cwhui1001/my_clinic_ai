import Link from "next/link";
import { redirect } from "next/navigation";

import { SignoutButton } from "@/app/components/signout-button";
import { getEscalationQueue } from "@/src/features/staff/service";
import { StaffAccessError } from "@/src/features/staff/auth";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  let dashboard;
  try {
    dashboard = await getEscalationQueue();
  } catch (error) {
    if (error instanceof StaffAccessError && (error.code === "unauthenticated" || error.code === "forbidden")) redirect("/staff/login");
    throw error;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Clinician dashboard</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Send-to-Clinic queue</h1>
            <p className="mt-2 text-sm text-slate-600">{dashboard.memberships.map((item) => `${item.clinicName} · ${item.role}`).join("; ")}</p>
          </div>
          <SignoutButton />
        </header>

        <section className="mt-7 grid gap-4">
          {dashboard.items.length ? dashboard.items.map((item) => (
            <Link key={item.id} href={`/staff/escalations/${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${riskStyle(item.riskLevel)}`}>{item.riskLevel}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{item.status}</span>
                </div>
                <p className="text-xs text-slate-500">Expected by {formatDate(item.responseExpectedBy)}</p>
              </div>
              <h2 className="mt-4 font-semibold text-slate-950">Patient {item.patientReference} · {item.clinicName}</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                {item.summary.slice(0, 3).map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            </Link>
          )) : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No patient-confirmed escalations are waiting in your clinics.</div>
          )}
        </section>
      </div>
    </main>
  );
}

function riskStyle(level: "low" | "medium" | "high") {
  if (level === "high") return "bg-red-100 text-red-800";
  if (level === "medium") return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-800";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
