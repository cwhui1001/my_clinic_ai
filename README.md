# Nightingale MVP

Nightingale is a secure first-touch-to-care PWA prototype. Phase 1 implements the application foundation, Supabase configuration, the LeadSession model, secure guest recovery, and immutable acquisition attribution.

AI chat, patient intake, risk gating, Living Memory, consent conversion, and escalation are intentionally not implemented yet.

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
- Do not prefix server secrets with `NEXT_PUBLIC_`.

## Database setup

### Option A: local Supabase

From the repository root:

```powershell
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` applies `supabase/migrations/202609020001_phase1_foundation.sql` and then `supabase/seed.sql`. Copy the local API URL, publishable/anon key, and secret/service-role key reported by `supabase status` into `.env.local`.

### Option B: hosted Supabase

1. Create a Supabase project.
2. Open its SQL editor.
3. Run `supabase/migrations/202609020001_phase1_foundation.sql`.
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

Choose a channel, optionally add context, and select **Start secure session**. The application creates the LeadSession and redirects to `/guest`, where the stored attribution is displayed.

## Automated verification

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
```

The unit tests verify attribution aliases, identity-level derivation, social-platform validation, strict input handling, and removal of query strings/referrer paths from stored attribution.

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
- `.env.example`: required public and server-only configuration.
