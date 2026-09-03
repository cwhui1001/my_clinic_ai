# Nightingale MVP

Nightingale is a secure first-touch-to-care PWA prototype. Phases 1 through 4 implement acquisition attribution, recoverable guest sessions, encrypted messaging, Supabase authentication, explicit consent, atomic guest-to-patient conversion, patient intake messaging, PHI redaction, and conservative risk-gated AI responses.

Living Memory, clinician RBAC, and persisted Send-to-Clinic escalation are intentionally not implemented yet.

## Phase 1 features

- Next.js 16 App Router application with TypeScript and Tailwind CSS.
- Supabase PostgreSQL migration and local configuration.
- Server and browser Supabase clients prepared for later Auth work.
- Guest LeadSession creation and recovery through an opaque HttpOnly cookie.
- Immutable attribution: clinic, source channel, platform, campaign, creative, identity level, landing timestamp, and safe landing metadata.
- Server-derived identity level so callers cannot elevate it themselves.
- AES-256-GCM encryption for optional preloaded context.
- Database-backed creation rate limit: ten LeadSessions per clinic/fingerprint per hour.
- Atomic `visitor` funnel-event creation.
- Declarative opening strategies and UI simulation for `staff_referral`, `social_comment`, `instagram_ad_click`, and `website_widget`.
- RLS enabled with no direct `anon` or `authenticated` access to Phase 1 tables.
- PHI-free structured operational logging.

## Phase 2 features

- Messenger-style guest conversation that survives refresh and private-link recovery.
- AES-256-GCM encryption for every guest and assistant message.
- Local PHI redaction for names, Singapore/Malaysian IC formats, Malaysian phone numbers, and email addresses before OpenAI.
- Fail-closed redaction assertion; raw message content never enters operational logs or funnel metadata.
- OpenAI Responses API with structured output, `store: false`, a hashed safety identifier, and an environment-selected model.
- Database-sourced service, hours, and availability answers with no fabricated statistics.
- Contextual concern summaries for personal clinical intent instead of diagnosis or treatment advice.
- Exact trust disclosure for “Are you a real doctor?”.
- Deterministic handling of all four mandatory emergency phrases before any model call.
- Typed `value_event` records and PHI-free `model_runs` provenance.
- Thirty guest messages per LeadSession per hour, plus idempotent client message IDs.
- Expiry removes unconverted encrypted messages while retaining PHI-free funnel events.

## Phase 3 features

- Supabase Auth email/password signup and login using server-managed auth cookies.
- Email verification required before consent or patient conversion.
- Phone collection at signup, held in an encrypted HttpOnly cookie until consent.
- Explicit, versioned healthcare-sharing consent naming the destination clinic; marketing consent remains a separate consent type and is never inferred.
- One atomic, idempotent `SECURITY DEFINER` conversion function with an empty search path, explicit `auth.uid()` checks, row locking, and restricted grants.
- Immutable clinic-scoped patient identity, changeable contact-point history, append-only consent events, and a `PatientSession` linked to the original `LeadSession`.
- Guest recovery credential revocation after conversion, with retry-safe hashed idempotency state.
- Patient-owned RLS for patient, contact, consent, session, and converted-origin message reads.
- Preserved acquisition attribution, referral context, and original encrypted guest messages so the patient does not need to repeat the concern.

## Phase 4 features

- Authenticated one-to-one patient messenger that preserves the converted guest thread.
- Raw patient text encrypted before processing and never written to operational logs or funnel metadata.
- Local redaction of names, Malaysian/Singaporean IC or ID formats, Malaysian phone numbers, and email addresses before any patient OpenAI request.
- Deterministic High-risk handling for all four mandatory emergency phrases and conservative close variants.
- Deterministic Medium-risk handling for ambiguous chest symptoms, diagnostic requests, medication-change requests, bleeding, faintness, and expressed uncertainty.
- Structured OpenAI risk and draft proposals for messages not resolved by deterministic gates, using `store: false`, a hashed safety identifier, approved minimum context, and strict schema validation.
- Server policy that prevents deterministic downgrades and suppresses advice for Medium, High, uncertain, invalid, ungrounded, or unsafe results.
- One immutable `risk_assessment` per patient message with level, redacted reason, confidence, escalation requirement, rule matches, pipeline version, model provenance, and timestamp.
- Low-risk responses require resolvable citations to active curated sources with verified source-span hashes.
- Risk assessment, model provenance, assistant response, and citations are committed atomically before the response is displayed.
- Fail-closed redaction and conservative model-timeout/error behavior.

## Prerequisites

- Node.js 20.18 or later. Node.js 22 LTS is recommended.
- npm.
- A Supabase project, or Docker plus the Supabase CLI for local development.

The Supabase packages are pinned to Node-20-compatible versions. The current ESLint dependency graph warns on Node versions below 20.19, so upgrade to Node 20.19+ or Node 22 if linting reports an engine warning.

## Environment setup

Copy `.env.example` to `.env.local` and replace every placeholder.

Generate the two application secrets with Node:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- Use the base64 value for `LEAD_CONTEXT_ENCRYPTION_KEY`.
- Use the hex value for `RATE_LIMIT_HMAC_KEY`.
- `SUPABASE_SECRET_KEY` accepts the current Supabase secret key. A local development service-role key also works, but it must remain server-only.
- Set `OPENAI_API_KEY` and `OPENAI_MODEL` for generated general-education and concern-summary responses. Clinic services, hours, availability, trust, and emergency responses remain deterministic.
- Do not prefix server secrets with `NEXT_PUBLIC_`.

## Database setup

### Option A: local Supabase

From the repository root:

```powershell
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` applies every migration in `supabase/migrations/` and then `supabase/seed.sql`. Copy the local API URL, publishable/anon key, and secret/service-role key reported by `supabase status` into `.env.local`.

### Option B: hosted Supabase

1. Create a Supabase project.
2. Open its SQL editor.
3. Run the migrations in filename order.
4. Run `supabase/seed.sql`.
5. Copy the project URL, publishable key, and secret key into `.env.local`.

Never expose the secret/service-role key in browser code or commit it.

For Phase 3, also configure Supabase Auth in the hosted dashboard:

1. Under **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` as a redirect URL. Add the equivalent production URLs when deployed.
2. Keep email confirmation enabled.
3. The default PKCE confirmation flow uses `/auth/callback`. If you customize the confirmation email to use a token hash, point it to `/auth/confirm?token_hash={{ .TokenHash }}&type=email` on your Site URL.

Do not run the new migration against production without first reviewing it in a preview project. For a linked hosted development project, apply migrations in order with `npx supabase db push`; alternatively paste `supabase/migrations/202609030002_patient_conversion.sql` into the SQL editor after the first two migrations.

Phase 4 adds two migrations that must run in filename order. PostgreSQL requires the new `patient` enum value to commit before stored functions use it:

1. `202609030003_patient_message_actor.sql`
2. `202609030004_patient_risk_pipeline.sql`

Run `npx supabase db push --dry-run` first, then `npx supabase db push` against the hosted development project.

## Run the application

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To prefill acquisition data, open:

```text
http://localhost:3000/?source=instagram_ad_click&campaign=ivf_over40&creative=reel_01&page=/fertility/egg-freezing
```

Choose a channel, optionally add context, and select **Start secure session**. The application creates the LeadSession and redirects to `/guest`, where the guest can ask questions and recover the encrypted thread later.

## Automated verification

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
```

The unit tests verify attribution normalization, strict input handling, all four mandatory emergency phrases, trust behavior, clinical-intent boundaries, patient risk escalation, response safety, required identifier redaction, citation gating, and fail-safe behavior.

## Manual Phase 4 verification

1. Apply migrations `202609030003` and `202609030004`, then sign in and open a converted patient session.
2. Send `Help me prepare what to tell the clinic.` Confirm a Low response includes at least one clickable approved source.
3. Send `My name is John Doe, my IC is S1234567A and my phone is +60 12-345 6789.` Confirm the protected original remains visible to the patient while `redaction_summary` records categories and counts only.
4. Send `My chest feels funny.` Confirm the persisted level is Medium, `escalation_required` is true, and no generated clinical advice is shown.
5. Send `I have crushing chest pain.` Confirm the persisted level is High, `escalation_required` is true, OpenAI is skipped, and the response tells the patient to exit and dial 999.
6. Temporarily use an invalid OpenAI key for a non-deterministic message. Confirm the result fails conservatively to Medium with safe handoff copy and a PHI-free model error code.

Inspect persistence in the Supabase SQL editor:

```sql
select ra.risk_level, ra.risk_reason, ra.confidence,
       ra.escalation_required, ra.rule_matches,
       ra.pipeline_version, ra.provenance, ra.assessed_at,
       mr.provider, mr.model, mr.status, mr.error_code, mr.store_requested
from public.risk_assessments ra
join public.model_runs mr on mr.id = ra.model_run_id
order by ra.assessed_at desc;

select c.assistant_message_id, ks.title, ks.publisher, ks.url,
       c.source_start, c.source_end, c.quoted_span_hash
from public.citations c
join public.knowledge_sources ks on ks.id = c.knowledge_source_id
order by c.created_at desc;
```

The Phase 4 risk result marks whether escalation is required but does not yet persist or deliver an escalation payload; that remains the Send-to-Clinic phase. The redaction layer is a data-minimization safeguard, not a claim of healthcare-regulatory compliance. Use synthetic data only.

## Manual Phase 3 verification

1. Apply `202609030002_patient_conversion.sql` to the hosted development project and configure the Auth URLs above.
2. Start a guest session and ask a service, hours, availability, trust, or contextual concern question. Confirm **Continue securely** appears only after value or clinical intent.
3. Create an account. Confirm the phone is not written to `contact_points` before consent, and follow the verification email.
4. On `/consent`, confirm the named clinic is shown and the healthcare checkbox is initially unchecked. Submit consent.
5. Confirm the resulting patient page shows the original thread, referral context when present, source attribution, and consent timestamp without asking the concern again.
6. Copy the original recovery URL before conversion and try it afterward. It must no longer restore guest access.
7. In a second account or signed-out browser, navigate directly to the patient-session URL. RLS must return no session content.

Inspect the conversion in the Supabase SQL editor:

```sql
select ls.status, ls.converted_patient_id, ls.converted_patient_session_id,
       ps.origin_lead_session_id, p.auth_user_id
from public.lead_sessions ls
join public.patient_sessions ps on ps.id = ls.converted_patient_session_id
join public.patients p on p.id = ps.patient_id
order by ls.converted_at desc
limit 5;

select type, action, policy_version, notice_version, captured_via, occurred_at
from public.consent_events
order by occurred_at desc
limit 5;

select name, lead_session_id, patient_session_id, source_channel, occurred_at
from public.funnel_events
where name in ('auth_started', 'consented', 'patient_created')
order by occurred_at desc;
```

Verify there is one linked patient session, one append-only healthcare-sharing grant, the original lead attribution is unchanged, and the phone contact contains ciphertext plus a hash rather than plaintext.

## Manual Phase 2 verification

1. Start a guest session from `/` and ask “What are the clinic hours?”. Confirm the response uses the seeded clinic hours.
2. Ask “Are you a real doctor?”. Confirm the answer identifies Nightingale as AI, names the clinic as the provider, and explains when a human becomes involved.
3. Send `My name is John Doe and my IC is S1234567A.` Confirm the UI retains the protected original while the response contains no raw identifier.
4. Send `I have crushing chest pain.` Confirm the response directs the guest to exit and dial 999 and does not provide clinical advice.
5. Refresh `/guest`; the prior thread should return. Select **Copy recovery link**, open it in a private browser, and confirm it redirects to a clean `/guest` URL with the thread restored.

Inspect persistence in Supabase:

```sql
select actor, status, content_ciphertext, content_sha256,
       redaction_status, redaction_version, redaction_summary,
       requires_secure_continue, sequence_number
from public.messages
order by created_at desc;

select provider, model, prompt_version, redacted_input_hash,
       store_requested, status, duration_ms, error_code
from public.model_runs
order by created_at desc;

select fe.name, ve.value_type, fe.source_channel, fe.occurred_at
from public.value_events ve
join public.funnel_events fe on fe.id = ve.funnel_event_id
order by fe.occurred_at desc;
```

Verify that message text is ciphertext, `store_requested` is false, redaction records contain only categories/counts, and substantive answers have an explicit value type.

The redaction pipeline is implemented in `src/features/redaction/redact.ts`. If redaction or its final leak assertion fails, OpenAI is not called, the source message is marked `blocked`, and a safe non-clinical response is returned. Provider timeout, API error, and invalid structured output create a PHI-free failed `model_run`; clinic facts still use deterministic database-backed answers.

## Manual Phase 1 verification

After creating a session in the UI, use the Supabase SQL editor:

```sql
select
  id,
  status,
  source_channel,
  social_platform,
  campaign_id,
  creative,
  identity_level,
  landing_timestamp,
  landing_context,
  context_ciphertext,
  social_handle_ciphertext,
  recovery_token_hash,
  expires_at
from public.lead_sessions
order by created_at desc
limit 5;
```

Verify:

- The channel, campaign, creative, identity level, and timestamp match the simulated arrival.
- `landing_context` contains only safe page/referrer metadata, never query-string values.
- `recovery_token_hash` is a 64-character hash; the raw recovery token appears only in the browser's HttpOnly cookie.
- If context was entered, `context_ciphertext` is populated and does not contain the plaintext.
- For a social-comment simulation, `social_handle_ciphertext` is populated and the raw handle does not appear in funnel events or logs.

Confirm the atomic visitor event:

```sql
select name, source_channel, identity_level, occurred_at, idempotency_key
from public.funnel_events
order by occurred_at desc
limit 5;
```

Confirm attribution cannot be rewritten:

```sql
update public.lead_sessions
set campaign_id = 'tampered'
where id = '<lead-session-id>';
```

The update must fail with `LeadSession attribution is immutable`.

Confirm recovery by refreshing `/guest`; the same session should load through the HttpOnly cookie. Clearing site cookies should make `/guest` report that no active session was found.

To inspect the API directly while preserving cookies:

```powershell
curl.exe -i -c cookies.txt -H "Content-Type: application/json" -d '{"clinicSlug":"nightingale-demo","source":"instagram_ad_click","campaignId":"ivf_over40","creative":"reel_01","pagePath":"/fertility"}' http://localhost:3000/api/lead-sessions
curl.exe -i -b cookies.txt http://localhost:3000/api/lead-sessions
```

Delete `cookies.txt` after verification because it contains a live guest recovery credential.

## Key documentation

- `REQUIREMENTS.md`: extracted candidate requirements and ambiguities.
- `ARCHITECTURE.md`: proposed MVP architecture and later-phase models.
- `supabase/migrations/202609020001_phase1_foundation.sql`: Phase 1 database objects, atomic creation function, grants, and RLS.
- `supabase/migrations/202609030001_guest_chat.sql`: encrypted guest messages, model provenance, value events, chat rate limiting, and retention cleanup.
- `supabase/migrations/202609030002_patient_conversion.sql`: patient/contact/consent/session tables, patient-owned RLS, and atomic conversion workflow.
- `supabase/migrations/202609030003_patient_message_actor.sql`: committed patient message actor required by PostgreSQL enum semantics.
- `supabase/migrations/202609030004_patient_risk_pipeline.sql`: patient messages, risk assessments, approved sources, citations, RLS, and atomic safety completion.
- `.env.example`: required public and server-only configuration.
