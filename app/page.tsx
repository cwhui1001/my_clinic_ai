import { LeadSessionStarter } from "@/app/components/lead-session-starter";
import type { SourceChannel } from "@/src/types/database";

const ENTRY_SOURCE_CHANNELS = new Set<SourceChannel>([
  "staff_referral",
  "social_comment",
  "instagram_ad_click",
  "website_widget",
]);

const ENTRY_SOURCE_ALIASES: Record<string, SourceChannel> = {
  instagram: "instagram_ad_click",
  website: "website_widget",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const sourceValue = first(query.source);
  const requestedSource = sourceValue
    ? ENTRY_SOURCE_ALIASES[sourceValue] || (sourceValue as SourceChannel)
    : undefined;
  const source =
    requestedSource && ENTRY_SOURCE_CHANNELS.has(requestedSource)
      ? requestedSource
      : "website_widget";

  return (
    <main className="page-shell">
      <section className="surface max-w-3xl">
        <p className="eyebrow">Nightingale · Phase 1</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-5xl">
          A secure first step from inquiry to care
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
          Start without creating an account. This phase records where the inquiry
          came from, creates a recoverable guest LeadSession, and keeps optional
          context encrypted.
        </p>
        <LeadSessionStarter
          defaults={{
            clinicSlug:
              process.env.NEXT_PUBLIC_DEFAULT_CLINIC_SLUG || "nightingale-demo",
            source,
            campaignId: first(query.campaign) || "",
            creative: first(query.creative) || "",
            pagePath: first(query.page) || "/",
          }}
        />
        <p className="mt-6 text-xs leading-5 text-slate-500">
          Phase 1 does not provide medical advice or AI chat. If this is an emergency,
          exit Nightingale and dial 999 for Emergency Services.
        </p>
      </section>
    </main>
  );
}
