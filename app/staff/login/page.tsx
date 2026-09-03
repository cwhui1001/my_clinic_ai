import { redirect } from "next/navigation";

import { StaffLoginForm } from "@/app/components/staff-login-form";
import { getStaffMemberships } from "@/src/features/staff/auth";

export const dynamic = "force-dynamic";

export default async function StaffLoginPage() {
  let hasMembership = false;
  try {
    const memberships = await getStaffMemberships();
    hasMembership = memberships.length > 0;
  } catch {
    // A missing session or membership is expected on the login page.
  }
  if (hasMembership) redirect("/staff");

  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Clinic team</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Sign in to the triage queue</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Access requires a verified Supabase account and an active Staff, Nurse, or Clinician membership assigned by the clinic.</p>
        <StaffLoginForm />
      </section>
    </main>
  );
}
