# Nightingale MVP

Nightingale is a secure first-touch-to-care prototype built for the 2026 Nightingale 48-Hour Candidate Build. It carries a guest from an attributed acquisition source through a useful AI-assisted exchange, verified authentication, explicit clinic-sharing consent, a patient intake conversation, Living Memory, safety gating, and a patient-confirmed clinician handoff.

The repository uses synthetic data only. It is a prototype, not a diagnostic system, medical device, production compliance claim, or substitute for emergency services.

## What is implemented

- Four simulated acquisition contracts: staff referral, social comment, Instagram ad click, and website widget.
- Immutable source/campaign/creative attribution and PHI-free funnel events.
- Recoverable guest sessions using an opaque HttpOnly credential with encrypted message storage.
- Useful guest responses, honest AI disclosure, and value-event tracking.
- Supabase email/password authentication, email verification, and explicit named-clinic healthcare-sharing consent.
- Atomic and idempotent `LeadSession -> PatientSession` conversion without re-asking the original concern.
- Authenticated patient chat with local PHI redaction before OpenAI.
- Deterministic emergency rules followed by model assessment and a conservative server policy gate.
- Curated citations for releasable Low-risk educational responses.
- Living Memory with append-only revisions, corrections, and source-message/model provenance.
- Patient-confirmed Send to Clinic with an encrypted point-in-time summary/profile snapshot and acquisition provenance.
- A same-clinic clinician dashboard with Staff/Nurse/Clinician RBAC; only Nurse and Clinician roles can author clinical responses.
- Structured PHI-free operational audit logs.

Real social-platform integrations, staff-authored referral links, warm-lead ranking, funnel dashboards, outbound notifications, and Voice AI are deliberately deferred.

## Stack

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS 4
- Supabase PostgreSQL and Supabase Auth
- OpenAI Responses API
- Zod validation and Vitest

## Prerequisites

- Node.js 20.19+; Node.js 22 LTS is recommended
- npm
- A hosted Supabase project
- An OpenAI API key for model-backed responses

## Environment setup

Copy the template and replace every placeholder:

```powershell
Copy-Item .env.example .env.local
```

Generate independent application secrets:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the base64 value for `LEAD_CONTEXT_ENCRYPTION_KEY` and the hex value for `RATE_LIMIT_HMAC_KEY`. `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, and both generated secrets are server-only and must never be prefixed with `NEXT_PUBLIC_` or committed.

The default model is configured by `OPENAI_MODEL`; the supplied template uses `gpt-5.4-mini`.

## Hosted Supabase setup

1. Create a Supabase project.
2. In **SQL Editor**, run every file in `supabase/migrations/` in filename order, from `202609020001_phase1_foundation.sql` through `202609100003_living_memory_integrity.sql`.
3. Run `supabase/seed.sql`.
4. Copy the project URL, publishable key, and secret key into `.env.local`.
5. Under **Authentication -> URL Configuration**, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` as redirect URLs.
6. Keep email confirmation enabled. Add equivalent production URLs before deployment.

If the project is linked to the Supabase CLI, preview and apply pending migrations with:

```powershell
npx supabase db push --dry-run
npx supabase db push
```

### Create a clinician account

1. In Supabase, open **Authentication -> Users -> Add user -> Create new user**.
2. Use a confirmed email and a password of at least eight characters containing a letter and number.
3. Replace the email below and run it in SQL Editor:

```sql
insert into public.clinic_memberships (clinic_id, auth_user_id, role)
select c.id, u.id, 'clinician'::public.member_role
from public.clinics c
join auth.users u on lower(u.email) = lower('clinician@example.com')
where c.slug = 'nightingale-demo'
on conflict (clinic_id, auth_user_id)
do update set role = excluded.role, active = true, updated_at = now();
```

The clinician signs in at `/staff/login`.

## Install and run

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A useful Instagram demo entry is:

```text
http://localhost:3000/?source=instagram_ad_click&campaign=ivf_over40&creative=reel_01&page=/fertility/egg-freezing
```

## Run the checks

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

The suite covers attribution validation, guest-to-patient conversion contracts, consent, trust copy, redaction, deterministic and model-assisted risk policy, Living Memory mutation/provenance, escalation payload integrity, and RBAC/database contracts. Scenario-named P0 tests live in `tests/scenarios/`.

The tests are focused unit and SQL-contract tests. They do not replace hosted-Supabase integration, browser E2E, penetration, clinical-safety, accessibility, or legal review.

## Where PHI redaction happens

The local redactor is `src/features/redaction/redact.ts`. It handles names expressed in supported contexts, Malaysian/Singaporean IC or ID formats, Malaysian phone numbers, and email addresses. Both guest and patient pipelines call it before any OpenAI request:

```text
raw input -> deterministic multilingual emergency floor
          -> persist a non-PHI idempotency reservation
          -> local redaction + leak assertion (fail closed)
          -> minimum redacted context -> OpenAI (store: false, explicit timeout)
          -> max(deterministic risk, model risk)
          -> deterministic output safety gate
          -> seal encrypted raw record + complete the turn
```

Raw message content is kept only as encrypted application data and is not written into the reservation row until all release gates finish. Operational logs use a runtime allowlist for UUID/SHA-256 identifiers and bounded codes; message text is not accepted. If redaction or its leak assertion fails, the model is not called and the response fails closed. A deterministic High still receives local 999 guidance even when redaction or the provider fails.

Relevant files:

- `src/features/redaction/redact.ts`: detection, replacement, and final leak assertion
- `src/features/risk/emergency-rules.ts`: shared English, Malay, and Chinese deterministic emergency floor
- `src/features/risk/output-safety.ts`: deterministic patient-facing diagnostic/reassurance gate
- `src/features/guest-chat/service.ts`: guest orchestration
- `src/features/patient-chat/pipeline.ts`: patient redaction, risk, model, and release gate
- `src/server/openai/guest-response.ts` and `patient-response.ts`: server-only OpenAI boundary using `store: false` and an abort deadline
- `src/server/logging/audit.ts`: structured PHI-free audit events with runtime sanitisation
- `supabase/migrations/202609100001_p0_safety_boundaries.sql`: non-PHI reservations and authenticated sealing
- `supabase/migrations/202609100002_guest_retention_schedule.sql`: hourly guest-expiry scheduling
- `supabase/migrations/202609100003_living_memory_integrity.sql`: durable guest bootstrap, immutable source snapshots, and append-only contradiction records

## How RBAC is enforced

Authorization is enforced server-side, not by hiding buttons:

1. Supabase Auth establishes the user identity in server-managed cookies.
2. PostgreSQL RLS limits patients to their own records and staff to active same-clinic memberships with effective healthcare-sharing consent.
3. Table grants deny direct mutation; narrow `SECURITY DEFINER` functions validate `auth.uid()`, membership, role, clinic, consent, status transitions, and payload integrity.
4. Next.js server services re-check identity/membership and return minimal DTOs.
5. UI routing is convenience only and is never treated as an authorization boundary.

| Role | Consented same-clinic escalation | Acknowledge | Clinical response | Close |
|---|---:|---:|---:|---:|
| Patient | Own status only | No | No | No |
| Staff | Read | Yes | No | No |
| Nurse | Read | Yes | Yes | Yes |
| Clinician | Read | Yes | Yes | Yes |

The main enforcement is in migrations `202609030002`, `202609030004`, `202609030005`, `202609030006`, and `202609100003`, with matching server checks in `src/features/staff/` and `src/features/memory/`.

## Manual acceptance path

1. Enter through the Instagram demo URL and confirm the source, campaign, and creative appear in acquisition details.
2. Ask a factual clinic question, then state a synthetic concern and choose **Continue securely**.
3. Create or sign in to a verified patient account, explicitly grant healthcare-sharing consent, and confirm the original guest conversation appears in the patient session.
4. Send `I take Advil`, then `Actually I stopped it last week`, then `Actually I started taking it again`; confirm the profile retains all three sourced revisions.
5. Send `No known allergies`, then `Penicillin gave me a rash`; confirm the patient profile flags an open contradiction and the clinician handoff preserves both sources.
6. Send `I have crushing chest pain`; confirm High risk, no clinical advice, emergency guidance, and a **Send to Clinic** action.
7. Send the escalation and confirm its status changes to `queued` with an honest response window.
8. Sign in at `/staff/login`, open the queue, and inspect the trigger, contradiction history, point-in-time profile, acquisition context, and provenance.
9. Record a clinician response and close the escalation.

Use only synthetic names, identifiers, contact details, and health scenarios.

## Failure behavior

| Failure | Behavior |
|---|---|
| Redaction/leak assertion | Do not call OpenAI; fail closed. Preserve local emergency guidance when the raw-message floor is High. |
| Model timeout/API/schema failure | Preserve the deterministic floor and return explicitly labelled, non-advisory safety-only copy with PHI-free metadata. |
| Authentication outage or invalid session | Reject protected reads/mutations; do not expose patient or staff data. |
| Database transaction failure | Do not display an uncommitted response; idempotency supports safe retry. |

## Submission documents

- `REQUIREMENTS.md`: requirements extracted from the candidate brief
- `TECHNICAL_BRIEF.md`: implemented architecture, schema, channel analysis, assumptions, scope, and Voice AI extension
- `ATTRIBUTION.txt`: external libraries, hosted services, models, and licenses/terms
- `DEMO_SCRIPT.md`: timed three-minute recording plan and evidence checklist
- `ARCHITECTURE.md`: the original pre-implementation architecture design

## Known scope boundaries

- The staff-referral entry is simulated; there is no staff UI that creates a private referral link.
- There is no warm-lead ranking view or per-channel funnel analytics dashboard.
- No email/SMS/social notification is sent when an escalation is queued.
- No production platform webhooks, scraping, direct messaging, or ad retargeting are implemented.
- No audio recording or transcription is implemented.
- Hosted database RLS should be integration-tested with separate Patient A, Patient B, Staff, Nurse, and Clinician accounts before any real-world use.
