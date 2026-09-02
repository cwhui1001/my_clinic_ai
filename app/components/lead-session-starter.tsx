"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { IdentityLevel, SocialPlatform, SourceChannel } from "@/src/types/database";
import type { LeadSessionDto } from "@/src/types/lead-session";

type Props = {
  defaults: {
    clinicSlug: string;
    source: SourceChannel;
    campaignId: string;
    creative: string;
    pagePath: string;
  };
};

const CHANNELS: { value: SourceChannel; label: string }[] = [
  { value: "staff_referral", label: "Staff referral" },
  { value: "social_comment", label: "Social comment" },
  { value: "instagram_ad_click", label: "Instagram ad click" },
  { value: "website_widget", label: "Website widget" },
];

const IDENTITY_LABELS: Record<IdentityLevel, string> = {
  anonymous: "Anonymous",
  social_handle: "Social handle known",
  email: "Email known",
  authenticated: "Authenticated",
};

export function LeadSessionStarter({ defaults }: Props) {
  const router = useRouter();
  const [source, setSource] = useState<SourceChannel>(defaults.source);
  const [socialPlatform, setSocialPlatform] =
    useState<SocialPlatform>("instagram");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identityLevel: IdentityLevel =
    source === "social_comment"
      ? "social_handle"
      : source === "lead_form"
        ? "email"
        : "anonymous";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/lead-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicSlug: defaults.clinicSlug,
          source,
          socialPlatform:
            source === "social_comment" ? socialPlatform : undefined,
          socialHandle:
            source === "social_comment"
              ? String(formData.get("socialHandle") || "")
              : undefined,
          campaignId: String(formData.get("campaignId") || "") || undefined,
          creative: String(formData.get("creative") || "") || undefined,
          pagePath: defaults.pagePath,
          context: String(formData.get("context") || "") || undefined,
        }),
      });

      const payload = (await response.json()) as {
        session?: LeadSessionDto;
        error?: string;
      };
      if (!response.ok || !payload.session) {
        throw new Error(payload.error || "Unable to create a LeadSession.");
      }

      router.push("/guest");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <label className="block">
        <span className="field-label">Simulated arrival channel</span>
        <select
          value={source}
          onChange={(event) => setSource(event.target.value as SourceChannel)}
          className="field-control"
        >
          {CHANNELS.map((channel) => (
            <option key={channel.value} value={channel.value}>
              {channel.label}
            </option>
          ))}
        </select>
      </label>

      {source === "social_comment" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Social platform</span>
            <select
              value={socialPlatform}
              onChange={(event) =>
                setSocialPlatform(event.target.value as SocialPlatform)
              }
              className="field-control"
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">Simulated social handle</span>
            <input
              className="field-control"
              name="socialHandle"
              defaultValue="@prospect"
              maxLength={160}
              required
            />
          </label>
        </div>
      ) : null}

      <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
        Derived identity level: <strong>{IDENTITY_LABELS[identityLevel]}</strong>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Campaign ID</span>
          <input
            className="field-control"
            name="campaignId"
            defaultValue={defaults.campaignId}
            maxLength={160}
          />
        </label>
        <label className="block">
          <span className="field-label">Creative</span>
          <input
            className="field-control"
            name="creative"
            defaultValue={defaults.creative}
            maxLength={160}
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">
          {source === "staff_referral"
            ? "Staff referral context"
            : "Optional preloaded context"}
        </span>
        <textarea
          className="field-control min-h-24 resize-y"
          name="context"
          maxLength={500}
          required={source === "staff_referral"}
          placeholder="For example: asked about egg freezing at today's visit"
        />
        <span className="mt-2 block text-xs leading-5 text-slate-500">
          Stored encrypted. It is never included in attribution or operational logs.
        </span>
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating secure session…" : "Start secure session"}
      </button>
    </form>
  );
}
