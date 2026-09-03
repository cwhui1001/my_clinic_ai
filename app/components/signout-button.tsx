"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60" type="button" onClick={signOut} disabled={pending}>
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
