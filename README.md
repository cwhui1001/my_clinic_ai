# Nightingale MVP

Nightingale is a secure first-touch-to-care PWA prototype. Phases 1 and 2 implement acquisition attribution, recoverable guest sessions, encrypted guest messaging, non-diagnostic guest value, PHI redaction, and OpenAI-backed general responses.

Patient intake, full risk gating, Living Memory, consent conversion, and clinician escalation are intentionally not implemented yet.

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

The unit tests verify attribution normalization, strict input handling, all four mandatory emergency phrases, trust behavior, clinical-intent boundaries, response safety checks, and required identifier redaction.

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
- `.env.example`: required public and server-only configuration.
