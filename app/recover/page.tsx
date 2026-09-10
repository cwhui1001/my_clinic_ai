import type { Metadata } from "next";

import { GuestRecovery } from "@/app/components/guest-recovery";

export const metadata: Metadata = { title: "Recover guest conversation", referrer: "no-referrer" };

export default function RecoverPage() {
  return <main className="page-shell"><section className="surface max-w-lg"><p className="eyebrow">Guest recovery</p><GuestRecovery /></section></main>;
}
