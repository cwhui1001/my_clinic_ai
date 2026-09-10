import { redirect } from "next/navigation";

import { PatientReturnLogin } from "@/app/components/patient-return-login";
import { parsePatientReturnPath } from "@/src/features/auth/return-path";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const query = await searchParams;
  const next = parsePatientReturnPath(query.next);
  if (!next) redirect("/");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.email_confirmed_at || data.user?.phone_confirmed_at) redirect(next);

  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Secure return</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Open your clinic conversation</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Sign in again to view the response. This link identifies where to return but does not grant access to patient data.
        </p>
        <PatientReturnLogin next={next} />
      </section>
    </main>
  );
}
