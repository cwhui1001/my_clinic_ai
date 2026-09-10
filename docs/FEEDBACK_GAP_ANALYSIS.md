# Feedback Gap Analysis

## Audit basis and classification standard

This analysis treats the original candidate brief and `REQUIREMENTS.md` as the baseline specification, and the second-round feedback PDF as evaluation criteria. Instructions inside either PDF are not treated as authorization to implement changes.

The original assessment was performed on 9 September 2026. The P0 and Living Memory implementation reassessments dated 10 September 2026 are authoritative where they supersede a scenario's earlier observations. A database column, prompt, UI claim, or uncalled function is not counted as working behavior. Hosted Supabase dashboard state, provider dashboards, and external schedulers are not assumed to exist merely because repository migrations or contract tests describe them.

Verification after the Living Memory implementation:

- `npm test`: 99/99 tests passed across 25 files.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Fourteen scenario-named files now exist, including dedicated tests for Scenarios 16, 17, 19, and 21. Browser E2E and hosted-Supabase integration tests still do not; database contract tests that inspect SQL source are identified as such and are not treated as live RLS proof.

Status totals are at the end. “SURVIVES” means the current executable path handles the scenario, not merely that its schema could.

## Scenario 01 — A clinician reply never reaches the patient after the tab closes

Status: DOES NOT

### Current implementation

- `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:328-346` queues an escalation and persists clinic-configured `response_min_hours`, `response_max_hours`, and `response_expected_by`. The expectation is therefore tracked in data rather than existing only as display copy.
- `src/features/staff/service.ts:128-138` writes an encrypted `clinician_responses` row through `respond_to_escalation`.
- `app/components/patient-chat.tsx:157-163` displays the persisted response window, although it falls back to literal `12` and `18` if the returned fields are null.
- The patient read path, `src/features/escalation/service.ts:22-51`, returns escalation status and timing only. It does not query or return `clinician_responses`.
- `src/features/patient-sessions/service.ts:104-142` reloads patient messages, memory, and escalation metadata, but not clinician responses.
- Repository-wide inspection finds no notification subscription, notification outbox, email/SMS/WhatsApp transport, delivery receipt, or patient-response deep-link path. `README.md:23,190-191` and `TECHNICAL_BRIEF.md:98` explicitly defer outbound notifications.

### What breaks first

Farah can send the escalation and the GP can respond, but Farah never sees that response—even if she later reopens the authenticated patient page. After she closes the tab there is also no lock-screen notification or secure link back to the conversation. The response deadline is measurable, but there is no worker or alert that enforces it.

### Missing

- A patient-visible clinician-response read path.
- One real transactional re-engagement channel.
- A notification outbox, retry state, delivery receipt, and overdue-response query.
- A single-use, expiring deep link that resolves only after Supabase authentication and verifies ownership of the target conversation.
- A pre-departure contact choice that is collected only after value and separately from marketing consent.

### Proposed fix

Implement one credible channel before attempting several: transactional email to the already verified auth email. In the same transaction that inserts a clinician response, enqueue a minimal notification job containing IDs, not PHI. A worker should render neutral copy, send it, record attempts/receipts, and link to an authenticated conversation route. Add an overdue queue based on `response_expected_by`; do not describe the response window as guaranteed.

### Files affected

- New migration for `notification_jobs`, `notification_attempts`, and a safe enqueue trigger/RPC.
- `src/features/staff/service.ts`
- `src/features/escalation/service.ts`
- `src/features/patient-sessions/service.ts`
- `src/types/escalation.ts`
- `app/components/patient-chat.tsx`
- New server-only notification provider/worker and secure re-entry route.
- `.env.example`, `README.md`, `TECHNICAL_BRIEF.md`

### Required test

`tests/scenarios/test_scenario_01_response_delivery.test.ts` — prove response insertion enqueues exactly one PHI-free notification, retries safely, requires authentication on the deep link, rejects another patient, and exposes the response to the correct patient.

## Scenario 02 — The patient has no email, only an Instagram handle and prepaid phone

Status: PARTIAL

### Current implementation

- `app/components/lead-session-starter.tsx:41-71,160-175` captures a social handle for the simulated social-comment entry.
- `src/features/lead-sessions/service.ts:149-178` encrypts that handle and passes it to `create_lead_session`; `supabase/migrations/202609020001_phase1_foundation.sql:37-64,184-212` stores it on `lead_sessions`.
- `app/components/auth-form.tsx:79-114` mandates email plus password and additionally requires a phone during signup.
- `supabase/migrations/202609030002_patient_conversion.sql:224-281` creates email and phone contact points. It never creates the supported `social_handle` contact-point type declared at line 2.
- `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:334-341` deliberately copies only non-contact attribution into the escalation snapshot. This avoids retaining email/handle in a long-lived payload, but there is no notification service that resolves the current phone/contact point when sending.

### What breaks first

Aina cannot convert without an email/password account. If she does obtain an email and converts, her phone survives as a patient contact point, but her Instagram handle is stranded on the LeadSession and is neither migrated nor usable for follow-up. The clinician payload has no safe contact-resolution mechanism, and no channel sends a reply.

### Missing

- Phone OTP or another supported no-email authentication path.
- Conversion of the encrypted social handle into a versioned patient contact point.
- A transactional contact preference and verified/reachable state.
- Runtime delivery that looks up the active contact point without copying it into the escalation snapshot.

### Proposed fix

Add Supabase phone-OTP authentication as the smallest no-email path, make email optional when phone is verified, migrate the encrypted social handle into `contact_points`, and keep contact values out of escalation snapshots. Notification workers should resolve the current verified contact point just in time.

### Files affected

- `app/components/auth-form.tsx`
- `app/api/auth/signup/route.ts`
- `src/features/auth/schema.ts`
- `app/api/conversion/route.ts`
- New conversion/contact migration following `202609030006_escalation_clinician_dashboard.sql`
- `src/types/database.ts`
- Notification files introduced for Scenario 01.

### Required test

`tests/scenarios/test_scenario_02_phone_social_identity.test.ts` — create a social-comment lead, verify encrypted handle storage, convert through verified phone without email, verify phone/handle contact history, and prove neither value appears in the escalation snapshot.

## Scenario 03 — Three days later on a different device, including expiry

Status: PARTIAL

### Current implementation

- `src/config/server-env.ts:9` defaults LeadSession TTL to seven days and permits 1–30 days.
- `app/api/lead-sessions/recovery-link/route.ts:10-24` generates a URL containing the opaque recovery token; `app/api/lead-sessions/recover/route.ts:8-27` validates it and installs an HttpOnly, `sameSite=lax` cookie. This is a working cross-device path while the token remains valid.
- `src/features/lead-sessions/service.ts:193-212` resolves only active/auth-started, unexpired sessions. It cannot distinguish expired from nonexistent.
- `app/api/lead-sessions/recover/route.ts:26-27` maps every failure to `/?recovery=invalid`; `app/page.tsx:21-65` never renders a recovery-specific explanation.
- `supabase/migrations/202609030001_guest_chat.sql:356-384` defines deletion/expiry logic, but no application call, migration schedule, or Supabase cron job invokes `expire_lead_sessions()`.

### What breaks first

At three days, the default seven-day link works if Mei Ling copied it. Once expired, she is sent to the generic landing page with no explanation, no safe summary, and no recovery choice. More seriously, the application hides the session because of the timestamp while the encrypted messages remain stored indefinitely unless an operator manually calls the cleanup function.

### Missing

- An explicit expired-link state and explanation of deletion/retention.
- An actually scheduled deletion job with observable success/failure.
- One-time or exchange-style recovery tokens that do not remain in URL history/access logs.
- A documented policy for converted records versus abandoned guest records.

### Proposed fix

Schedule cleanup in hosted Supabase with `pg_cron`, record each run, and alert on failure. Add an expired recovery page that states the data outcome and starts a fresh guest session without claiming the old content is recoverable. Exchange the URL token for a cookie through a no-referrer page/POST and rotate it after recovery.

### Files affected

- New retention/cron migration.
- `app/api/lead-sessions/recover/route.ts`
- `app/page.tsx` or a new recovery page.
- `src/features/lead-sessions/service.ts`
- `README.md`, `.env.example`

### Required test

`tests/scenarios/test_scenario_03_expired_cross_device_recovery.test.ts` — prove valid cross-device recovery, explicit expired behavior, token rotation, and actual deletion/anonymisation after the retention deadline.

## Scenario 04 — Value before identity and consent-gated staff visibility

Status: PARTIAL

### Current implementation

- `src/features/guest-chat/service.ts:203-305` completes guest turns and writes a typed `value_event` only when substantive value was returned.
- `app/components/guest-chat.tsx:231-243` presents secure continuation after a value-producing turn; there is no initial signup wall.
- `supabase/migrations/202609030002_patient_conversion.sql:203-216` independently enforces a value event/secure-continuation flag before conversion, so bypassing the UI does not bypass the gate.
- `app/components/consent-form.tsx:56-63` requires an explicit named-clinic healthcare-sharing action.
- `supabase/migrations/202609030001_guest_chat.sql:387-401` gives anon/authenticated users no direct guest-message table access. Later staff access at `202609030006_escalation_clinician_dashboard.sql:556-567` requires `has_consented_patient_access`; there is no `session_type = 'lead' OR consented` disjunct.
- `src/features/staff/service.ts:10-71` exposes only RLS-authorized, queued escalations. Pre-consent required escalations are excluded.

### What breaks first

The described premature signup and pre-consent staff-read paths do not occur in the current implementation. The first identity ask follows a value event, and staff cannot read the guest transcript until conversion/consent. The most likely regression would be a future service-role endpoint returning guest messages without first proving a token or authenticated resource relationship.

### Missing

There is no hosted-Supabase integration test demonstrating the denial with real Guest, Staff, and Patient sessions. Current tests inspect SQL text.

### Proposed fix

Keep the flow and add a negative integration test. Introduce a rule that any service-role read of patient/guest content must accept an already-authorized internal ID, never a client-supplied clinic or patient ID alone.

### Files affected

- New hosted integration test and test fixtures only.
- `README.md` to document how to run it.

### Required test

`tests/scenarios/test_scenario_04_value_and_guest_visibility.test.ts` — prove no identity is requested before value, Staff/Nurse/Clinician read zero pre-consent guest rows, and visibility appears only after current healthcare-sharing consent.

## Scenario 05 — Escalation attribution carries too little or too much

Status: PARTIAL

### Current implementation

- `supabase/migrations/202609030002_patient_conversion.sql:307-355` links `patient_sessions.origin_lead_session_id` and copies the lead identity level into conversion funnel events.
- `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:334-341` creates an allowlisted attribution snapshot: source channel, social platform, campaign, creative, landing timestamp, and landing context.
- That snapshot omits `identity_level`. The `escalation_sent` event at lines 350-367 writes literal `authenticated`, overwriting the acquisition identity rather than retaining both acquisition and current identity.
- `src/types/escalation.ts:54-61`, `src/features/staff/service.ts:96-103`, and `app/staff/escalations/[escalationId]/page.tsx:46` likewise omit identity level.
- The allowlist correctly excludes email, phone, and social handle, so the over-retention failure described by the judges does not occur.
- There is no live funnel-statistics service or UI; `README.md:190` explicitly says it is deferred.

### What breaks first

The nurse sees the acquisition channel/campaign but cannot tell what identity evidence existed at acquisition or distinguish it from the now-authenticated patient. Funnel data also loses that distinction at escalation. No PII is over-copied, but the payload is under-specified.

### Missing

- Separate `acquisition_identity_level` and current/authenticated state in the payload.
- DTO and clinician display support.
- Live, clinic-scoped funnel aggregation with an honest zero state.

### Proposed fix

Add only the original identity enum—not contact values—to `attribution_snapshot`, expose it in the staff DTO/UI, and preserve both acquisition and current identity in funnel metadata. Add a clinic-scoped SQL function/view for live funnel counts; return zeros from real aggregates rather than seeded/demo numbers.

### Files affected

- New attribution/funnel migration.
- `src/types/database.ts`
- `src/types/escalation.ts`
- `src/features/staff/service.ts`
- `app/staff/escalations/[escalationId]/page.tsx`
- New staff funnel service/page.

### Required test

`tests/scenarios/test_scenario_05_attribution_minimisation.test.ts` — prove all non-PHI attribution plus original identity survive all three hops, current identity is separate, contact values are absent, and an empty clinic returns real zero metrics.

## Scenario 06 — An earned-email promise without a mail transport

Status: SURVIVES

### Current implementation

- There is no “leave your email and we will send a summary” copy in application code.
- Email is requested only in the explicit account-creation form at `app/components/auth-form.tsx:79-83`.
- `README.md:23,191` and `TECHNICAL_BRIEF.md:98` honestly state that outbound email/notifications are deferred.
- No mail transport exists, but the broken promise in this scenario has been removed rather than falsely presented.

### What breaks first

The stated scenario does not occur because the product makes no earned-summary promise. A future copy edit could silently reintroduce the promise while transport remains absent.

### Missing

An automated capability/copy guard. The original brief’s earned-email feature remains intentionally unimplemented, but the feedback explicitly permits removal of promises that cannot be fulfilled.

### Proposed fix

Do not add earned-email copy before a real transport and delivery-state model exist. Add a small content assertion and keep the deferral explicit.

### Files affected

- New scenario test.
- `README.md` only if wording needs to be made more prominent.

### Required test

`tests/scenarios/test_scenario_06_no_unearned_email_promise.test.ts` — assert guest UI contains no email-summary delivery promise unless the email capability is configured and tested.

## Scenario 07 — Transactional and marketing consent are legally distinct

Status: PARTIAL

### Current implementation

- `supabase/migrations/202609030002_patient_conversion.sql:1-4,57-72` models distinct `healthcare_sharing` and `marketing_email` consent types and append-only evidence with action, timestamp, policy version, notice version, and evidence.
- `app/components/consent-form.tsx:56-63` displays only one checkbox, explicitly limited to healthcare follow-up; it does not claim marketing permission.
- `app/api/conversion/route.ts:40-51` and `convert_lead_to_patient` at migration lines 129-305 write only `healthcare_sharing` consent.
- No production writer or UI ever records `marketing_email`, and there is no lawful-marketing-audience query.

### What breaks first

Healthcare sharing remains legally separated from marketing by omission, so nobody is accidentally opted into promotions. However, staff cannot collect a valid default-off marketing opt-in or answer “who can receive the December screening message?” from a supported query.

### Missing

- Separate optional marketing control, text/notice versions, and timestamped event writer.
- Withdrawal path and current-consent query/view.
- Purpose/channel specificity if marketing expands beyond email.

### Proposed fix

Add an unchecked marketing-email checkbox with its own version constants and append-only event. Keep conversion independent of that answer. Add a clinic-scoped current-consent view/function that selects only the latest granted event and an active verified email contact.

### Files affected

- `app/components/consent-form.tsx`
- `app/api/conversion/route.ts`
- `src/features/consent/constants.ts`
- New consent migration/RPC/view.
- `src/types/database.ts`

### Required test

`tests/scenarios/test_scenario_07_separate_consents.test.ts` — prove healthcare consent is required, marketing defaults off and is optional, each event has independent versions/timestamps, withdrawal wins, and the campaign query excludes non-consenting patients.

## Scenario 08 — Deterministic emergency floor that the model cannot lower

Status: SURVIVES

### Current implementation

- `src/features/patient-chat/pipeline.ts:51` assesses the raw message before redaction.
- `src/features/risk/policy.ts:12-25,62-75` defines deterministic High/Medium rules, including crushing/severe chest pain and flexible difficulty-breathing word order.
- `src/features/patient-chat/pipeline.ts:100-118` returns immediately for any deterministic result, so the LLM is not called and cannot lower it.
- `src/features/patient-chat/pipeline.ts:54-90` preserves the deterministic result if redaction fails; otherwise it fails conservatively to Medium.
- `tests/unit/patient-risk.test.ts:47-75` verifies model suppression and that redaction failure cannot lower deterministic High.
- The guest path also checks raw intent before redaction at `src/features/guest-chat/service.ts:203-218` and returns local emergency copy without a model call.

### What breaks first

The exact English crushing-chest-pain and difficulty-breathing examples receive the 999 response without model involvement. The current floor’s principal limit is language coverage, addressed in Scenario 09.

### Missing

Versioned multilingual coverage and a hosted/API-level regression test; current proof is unit-level.

### Proposed fix

Retain the ordering and early return. Move the duplicated guest/patient emergency rules into one versioned multilingual policy and prove the same floor through both public API routes.

### Files affected

- `src/features/risk/policy.ts`
- `src/features/guest-chat/policy.ts`
- Guest and patient API scenario tests.

### Required test

`tests/scenarios/test_scenario_08_unlowerable_emergency_floor.test.ts` — inject an LLM response proposing Low and prove it is never called/released for each deterministic High phrase, including when redaction throws.

## Scenario 09 — Malay/English mixed-language emergency detection

Status: SURVIVES

### Current implementation

- Patient risk rules in `src/features/risk/policy.ts:12-25` are English-only.
- Guest emergency rules in `src/features/guest-chat/policy.ts:5-13` are also English-only.
- “chest tightness” inside a Malay sentence matches the patient ambiguous-chest rule and becomes Medium, not High. `dada saya sakit, susah nak bernafas` matches no deterministic rule.
- On the guest path, the fully Malay phrase is classified as general education at `src/features/guest-chat/policy.ts:36-49`, so it can reach the model and on timeout receives generic failure copy rather than the 999 floor.
- There are no Malay or Chinese emergency tests.

### What breaks first

The mixed-language message does not receive the deterministic emergency floor; the fully Malay chest-pain/breathlessness message can be treated as ordinary guest education. During provider failure, the patient may never see the 999 instruction.

### Missing

- Bahasa Malaysia patterns and normalization for common colloquial forms such as `sakit dada`, `sesak nafas`, and `susah ... bernafas`.
- A third clinic-supported language set and explicit locale ownership.
- Shared guest/patient rules, versioning, clinician review, and adversarial tests.
- The feedback says “trilingual” but does not specify the third language, script, dialect, or transliteration policy. That must be confirmed with the clinic; Mandarin Chinese is a reasonable test candidate, not an assumption to silently ship.

### Proposed fix

Create one normalized, versioned emergency-rule module shared by guest and patient paths. Add conservative English and Bahasa Malaysia rules immediately; add the clinic-confirmed third language only with bilingual clinical review. High-severity recall should be favored, with false positives routed to urgent human help rather than diagnosis.

### Files affected

- `src/features/risk/policy.ts`
- `src/features/guest-chat/policy.ts`
- Preferably a new shared `src/features/risk/emergency-rules.ts`
- `src/types/database.ts` and a migration only if language/rule-version provenance is persisted.

### Required test

`tests/scenarios/test_scenario_09_multilingual_emergency_floor.test.ts` — table-test mixed English/BM, full BM, and the clinic-approved third language across guest and patient paths, proving High/999 and zero LLM calls.

## Scenario 10 — Raw risk assessment, redaction, MyKad, model, and storage order

Status: SURVIVES

### Current implementation

- Raw content is first persisted as encrypted application data in `src/features/patient-chat/service.ts:39-49` (or guest equivalent at `src/features/guest-chat/service.ts:178-188`). It is not logged or sent externally.
- The patient pipeline then executes raw deterministic risk at `src/features/patient-chat/pipeline.ts:51`, local redaction/leak assertion at lines 54-56, and only then an LLM call at lines 120-121.
- The guest path classifies raw intent at `src/features/guest-chat/service.ts:203`, redacts/asserts at lines 217-235, and calls the model only at lines 237-246.
- `src/features/redaction/redact.ts:71-76,116-133` handles MyKad in hyphenated or compact form and performs a post-redaction leak assertion.
- `src/features/patient-chat/pipeline.ts:57-90` and `src/features/guest-chat/service.ts:272-281` fail closed and skip the model if redaction cannot be verified.
- `tests/unit/redaction.test.ts:9-38` covers the required IC/MyKad, phone, email, and regression assertion; `tests/unit/patient-risk.test.ts:78-128` proves only redacted identifiers reach the injected model function.

### What breaks first

The exact ordering and MyKad example survive. The remaining accuracy risk is the broad capitalized-name heuristic at `src/features/redaction/redact.ts:90-104`, which may remove clinical capitalized word pairs from low-risk model context. The raw emergency floor still runs before that heuristic.

### Missing

A trace-level integration test covering both API routes and a larger Malaysian redaction corpus. The documentation diagram at `README.md:124-125` omits that raw encrypted storage occurs before pipeline evaluation and should be clarified.

### Proposed fix

Keep the code order. Add a stage-recorder test and tighten the broad name heuristic with contextual allowlists/NER evaluation, while preserving fail-closed behavior.

### Files affected

- `src/features/redaction/redact.ts`
- `README.md`
- New scenario test.

### Required test

`tests/scenarios/test_scenario_10_risk_redaction_order_mykad.test.ts` — record stage order, prove raw text reaches only local risk/encryption, MyKad is absent from provider input, and a redaction exception results in no provider call.

## Scenario 11 — PHI leakage through logs, errors, SDKs, and provider retention

Status: PARTIAL

### Current implementation

- `src/server/logging/audit.ts:3-22` accepts only action, outcome, resource type/ID, error code, and timestamp. It writes this allowlist to `console.info`; no message/body field exists.
- API routes return allowlisted error codes. Examples: `app/api/guest/messages/route.ts:89-102` and `app/api/patient/sessions/[sessionId]/messages/route.ts:36-62` do not return exception messages or prompts.
- Provider clients use direct `fetch`, send only redacted message/context, use hashed `safety_identifier`, omit response bodies from errors, and set `store: false`: `src/server/openai/guest-response.ts:61-76,148-156` and `src/server/openai/patient-response.ts:55-90,158-185`.
- Repository grep finds raw message use in encryption, local policy/redaction, and browser request bodies, but no logger call containing it. There is no evidence that a unique test-patient phrase has been traced through deployed platform logs, APM, proxy logs, or the provider dashboard.
- The repository does not document or evidence an OpenAI data-retention control. Official OpenAI documentation states that abuse-monitoring logs may retain customer content for up to 30 days by default even when application-state storage is disabled; eligible customers may obtain Modified Abuse Monitoring or Zero Data Retention subject to approval: [OpenAI API data controls](https://platform.openai.com/docs/guides/your-data).

### What breaks first

Normal application logs and handled errors are designed not to leak content. The unproven boundary is deployed infrastructure/provider retention: `store:false` alone is not proof of zero retention, and there is no evidence from an end-to-end marker search. A framework/APM configuration added later could capture request bodies.

### Missing

- A documented provider DPA/retention posture, project eligibility, region/residency decision, and approved PHI use.
- Deployment-level log/body-capture inventory and redaction settings.
- A synthetic canary-phrase test across application, hosting, APM, and provider logs.

### Proposed fix

Document the exact OpenAI project controls and contract, disable request-body capture in hosting/APM, centralize sanitized error reporting, and run a synthetic canary audit. If the project cannot obtain an acceptable provider arrangement for PHI, continue sending only locally redacted minimum context and state the residual 30-day abuse-log risk; do not claim zero retention.

### Files affected

- `README.md`, `TECHNICAL_BRIEF.md`, data-flow/threat-model documentation.
- Hosting/APM configuration files if present.
- `src/server/logging/audit.ts` for a tested sink adapter.
- New provider-boundary test.

### Required test

`tests/scenarios/test_scenario_11_no_phi_egress.test.ts` — inject a unique name/MyKad/phone marker, capture provider request, audit sink, route error, and console output, and prove the marker appears only in encrypted database payloads.

## Scenario 12 — Guest PHI boundary, retention, rate limiting, and staff roles

Status: PARTIAL

### Current implementation

- Encryption is called before persistence at `src/features/guest-chat/service.ts:178-188`; the ciphertext implementation is in `src/server/crypto/protected-content.ts`.
- Direct table access is revoked at `supabase/migrations/202609030001_guest_chat.sql:387-401`. Staff visibility requires active same-clinic membership plus latest healthcare-sharing consent at `202609030006_escalation_clinician_dashboard.sql:114-145,556-567`.
- After consent, all three active membership roles—Staff, Nurse, and Clinician—can read patient/converted-origin messages. Only Nurse and Clinician can author clinical responses (`src/features/staff/service.ts:115,128-138` plus database role checks).
- Lead creation is limited to 10 per fingerprint/clinic/hour at `202609020001_phase1_foundation.sql:170-181`. Guest messages are limited to 30 per LeadSession/hour at `202609030001_guest_chat.sql:131-138`.
- `expire_lead_sessions()` would delete messages and clear guest context/handle/token at `202609030001_guest_chat.sql:356-384`, but repository-wide search finds no invocation or schedule.

### What breaks first

Encryption, staff consent gating, and rate limits execute. On day N+1, reads fail because every resolver checks `expires_at`, but the guest transcript remains in the database. The product therefore provides access expiry, not proven destruction.

### Missing

- Scheduled and monitored retention execution.
- A deletion ledger/metric and failure alert.
- Rate limiting across distributed abuse dimensions (IP/clinic/token/device), with proxy-header trust documented.
- A reviewed least-privilege decision on whether generic Staff should read full patient messages after consent.

### Proposed fix

Schedule cleanup in Supabase, make batches observable/idempotent, and define separate abandoned-guest and converted-clinical retention policies. Add a staff role/content matrix and restrict full clinical content to Nurse/Clinician unless Staff access is explicitly justified.

### Files affected

- New retention/cron and optional role-policy migration.
- `src/features/staff/service.ts`
- `README.md`, `TECHNICAL_BRIEF.md`
- Integration tests and retention fixtures.

### Required test

`tests/scenarios/test_scenario_12_guest_boundary_retention.test.ts` — prove encryption, pre-consent zero-row staff reads, role matrix, rate-limit rejection, scheduled deletion after TTL, and no remaining raw/ciphertext guest content for an abandoned session.

## Scenario 13 — Guest model hangs and the UI waits

Status: SURVIVES

### Current implementation

- `src/config/server-env.ts:14-22,44-49` sets an explicit OpenAI timeout, default 15 seconds and capped at 30 seconds.
- `src/server/openai/guest-response.ts:61-72,148-156` aborts the provider fetch and maps abort to a timeout error.
- `src/features/guest-chat/service.ts:251-281` catches provider/redaction failure and persists safe non-medical failure copy; `app/components/guest-chat.tsx:78-120,225-228` replaces the spinner when the route returns.
- The browser fetch itself has no timeout, and database/network calls around the model have no deadline.
- Raw guest emergency rules run before the model, but `sakit dada` matches neither `EMERGENCY_RULES` nor the English clinical-intent expression at `src/features/guest-chat/policy.ts:5-13,36-49`.

### What breaks first

If only OpenAI hangs, Ana should see the safe failure response well before second 45. If the route/database hangs, the browser can spin indefinitely. If she writes `sakit dada`, the local emergency check executes but misses it, so the timeout response lacks the 999 floor.

### Missing

- Client/route-level deadline covering the complete turn.
- Multilingual emergency floor.
- A literal UI timeout/degraded-mode scenario test.

### Proposed fix

Add a client abort slightly above the server budget, a total server deadline, and shared multilingual emergency rules. On client timeout, render stable safety copy and a retry option while preserving the idempotent message ID.

### Files affected

- `app/components/guest-chat.tsx`
- `src/server/openai/guest-response.ts`
- `src/features/guest-chat/service.ts`
- Shared emergency-rule module from Scenario 09.

### Required test

`tests/scenarios/test_scenario_13_guest_timeout.test.ts` — use a never-resolving provider, advance fake timers to 45 seconds, assert no spinner, assert safe copy, and assert `sakit dada` still produces 999 without a provider call.

## Scenario 14 — Provider outage and rule-only degraded mode

Status: PARTIAL

### Current implementation

- Deterministic risk is outside the model try path: patient `src/features/patient-chat/pipeline.ts:51-118`; guest `src/features/guest-chat/service.ts:203-235`.
- English `difficulty breathing` is High in `src/features/risk/policy.ts:13` and `src/features/guest-chat/policy.ts:7`, so the exact English message receives hard-coded 999 copy without calling OpenAI.
- Non-deterministic patient provider failures become conservative Medium/escalation with local safe copy at `src/features/patient-chat/pipeline.ts:161-172`; guest failures use `SAFE_FAILURE_RESPONSE` at `src/features/guest-chat/service.ts:251-259`.
- There is no outage state, circuit breaker, health signal, or explicit user label saying the service is operating in rule-only degraded mode.

### What breaks first

The exact English difficulty-breathing emergency survives a dead key. Other supported English messages fail conservatively. Malay emergencies still miss the floor, and every non-rule request continues attempting the failed provider rather than entering a controlled hour-long degraded mode.

### Missing

- Shared multilingual rules.
- Circuit breaker/short-lived provider health state.
- Explicit degraded-mode provenance and UI label.
- Operational alerting.

### Proposed fix

Add a small circuit breaker with a short TTL, keep emergency rules always active, and label local fallback responses as temporary limited mode. It may provide clinic facts, emergency instructions, and secure handoff; it must refuse diagnosis, treatment, and reassurance.

### Files affected

- Shared emergency-rule module.
- `src/features/guest-chat/service.ts`
- `src/features/patient-chat/pipeline.ts`
- `src/server/openai/guest-response.ts`
- `src/server/openai/patient-response.ts`
- Guest/patient DTOs and chat components for degraded-mode metadata.

### Required test

`tests/scenarios/test_scenario_14_provider_outage_degraded_mode.test.ts` — force repeated 503s, prove the circuit opens, English/BM emergencies still receive 999, routine output is locally bounded/labeled, and no diagnosis is emitted.

## Scenario 15 — The prompt forbids diagnosis but the model diagnoses anyway

Status: SURVIVES

### Current implementation

- The model prompt prohibits diagnosis at `src/server/openai/patient-response.ts:72-82`.
- A real output-side release gate is called at `src/features/patient-chat/pipeline.ts:142-160`, so safety does not rely solely on the prompt.
- However, `src/features/risk/policy.ts:122-132` detects a narrow set such as “you have,” medication changes, reassurance, and “wait and see.” It does not match the judges’ exact output: `this is likely gastritis, not cardiac`.
- If the model also returns Low, confidence, and a valid citation, that exact sentence is released. Guest output patterns at `src/features/guest-chat/policy.ts:15-21` have the same gap.
- `tests/unit/patient-risk.test.ts:133+` proves one diagnostic form is blocked, not the judges’ form or adversarial paraphrases.

### What breaks first

The patient reads a differential diagnosis/reassurance under the clinic product’s name. The existence of a called helper does not save this scenario because the actual phrase passes it.

### Missing

- Broader deterministic diagnosis/differential/reassurance patterns.
- A constrained rewrite/block response independent of model self-report flags.
- An adversarial output corpus for guest and patient surfaces.

### Proposed fix

Expand the release gate to block “likely/probably/consistent with/sounds like” disease claims and comparative exclusions such as “not cardiac/not cancer,” then replace the whole answer with local safe handoff copy. Do not ask the same model to certify its own unsafe answer as the only control.

### Files affected

- `src/features/risk/policy.ts`
- `src/features/guest-chat/policy.ts`
- `src/features/patient-chat/pipeline.ts`
- `src/features/guest-chat/service.ts`

### Required test

`tests/scenarios/test_scenario_15_output_diagnosis_gate.test.ts` — inject the exact gastritis/cardiac and angina/heart-attack examples plus paraphrases; prove none render and the patient sees deterministic safe handoff copy.

## Scenario 16 — “I stopped it last week” and correction provenance

Status: SURVIVES

### Current implementation

- `supabase/migrations/202609030005_living_memory.sql:30-48,59-71` stores immutable `memory_revisions`, blocks update/delete, and links a stable item to its current revision.
- `apply_memory_revisions_internal` at lines 140-204 validates the source message, inserts a new revision, sets `supersedes_revision_id` to the prior current revision, and advances the current pointer.
- `src/features/memory/extract.ts:29-56,146-151` can convert a single known active medication to `stopped` and preserves “last week” inside `stoppedTimeline`.
- The exact phrase “I stopped it last week” is mishandled: the named-medication regex at lines 33-45 treats `it` as a medication key, fails to find an `it` fact, and does not use the single-active-medication fallback.
- `tests/unit/memory-mutation.test.ts:10-52` tests “Actually I stopped last week” without the word `it`, so it does not prove the judges’ scenario.

### What breaks first

Advil remains displayed as active. No stopped revision is proposed, so the GP may believe the patient still takes it. The database’s append-only design is sound, but the executable extraction path fails before it reaches that design.

### Missing

- Pronoun-aware single-medication correction.
- Structured temporal semantics (`effective_at` remains null even though text contains “last week”).
- Correction-of-correction tests, including restart and ambiguous multiple-medication cases.

### Proposed fix

Treat `it/that/the medication` as an unnamed reference; resolve only when exactly one active medication exists, otherwise create a clarification/contradiction flag rather than guessing. Preserve the verbatim temporal phrase and optionally a normalized uncertain interval. Continue using superseding inserts.

### Files affected

- `src/features/memory/extract.ts`
- `src/types/memory.ts`
- New migration only if temporal precision or clarification flags are persisted.
- `app/components/patient-chat.tsx` if uncertainty is displayed.

### Required test

`tests/scenarios/test_scenario_16_medication_correction.test.ts` — run “I take Advil” → nine unrelated turns → “I stopped it last week” → correction of that correction, then assert all immutable revisions, source IDs, supersedes links, timeline, and correct current state.

## Scenario 17 — Guest facts survive conversion with original provenance

Status: SURVIVES

### Current implementation

- This has a real writer, not only schema support: `app/api/conversion/route.ts:40-59` completes conversion and calls `bootstrapGuestMemory(patientSessionId)`.
- `src/features/memory/service.ts:98-149` loads completed/blocked guest messages from the origin LeadSession, decrypts each in chronological order, extracts facts, and applies encrypted proposals with each original guest `message.id` as `source_message_id`.
- `supabase/migrations/202609030005_living_memory.sql:140-150` verifies that each source belongs to the patient session or its origin lead.
- `src/features/patient-sessions/service.ts:36-42,115-142` loads the converted guest transcript and Living Memory into the patient view; `app/components/patient-chat.tsx:203-241` shows memory before an empty chat prompt. There is no hardcoded repeat of “what brings you in today?”
- Bootstrap happens after the conversion transaction commits. If it fails, the route returns an error after conversion and relies on an idempotent retry. Extraction is narrow and may not recognize free-form irregular-bleeding descriptions.
- Expired leads are rejected by `convert_lead_to_patient` at `202609030002_patient_conversion.sql:177-216`; there is no post-expiry conversion path.

### What breaks first

Explicitly phrased guest facts survive with original message provenance. Free-form wording may produce no fact, and a bootstrap failure creates a temporarily converted patient with missing memory. If the guest session expired first, conversion cannot proceed and the patient must start again.

### Missing

- Atomic/outbox-backed bootstrap completion state.
- Broader deterministic extraction or reviewed model extraction for guest facts.
- Explicit expired-session UX and policy.
- Suggested post-conversion question bubbles grounded in the prior conversation.

### Proposed fix

Put a `memory_bootstrap_pending/completed` state or outbox record inside the conversion transaction and process it idempotently. Never claim conversion is complete until bootstrap has succeeded or the UI clearly reports degraded profile import. Keep original message IDs and add grounded suggestion chips rather than repeating intake.

### Files affected

- `app/api/conversion/route.ts`
- `src/features/memory/service.ts`
- New conversion-outbox/status migration.
- `src/features/patient-sessions/service.ts`
- `app/components/patient-chat.tsx`

### Required test

`tests/scenarios/test_scenario_17_guest_memory_conversion.test.ts` — persist guest bleeding facts, convert, prove original guest message provenance/current profile/no repeated question, simulate bootstrap failure and retry, and verify explicit expired-session behavior.

## Scenario 18 — A nurse opens the escalation payload cold

Status: SURVIVES

### Current implementation

- `src/features/escalation/payload.ts:4-41` emits `triageSummary`, current `profileSnapshot`, and normalized provenance. The summary contains risk level/confidence/reason, a trigger excerpt capped at 500 characters, and a capped current-profile summary.
- `src/features/escalation/service.ts:54-93` builds that payload from the authorized trigger/risk/memory and encrypts summary/snapshot before calling the queue RPC.
- `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:263-325` checks ciphertext/hash bounds, provenance array shape/count, exact trigger provenance, and patient/session ownership of every message/revision reference.
- The persisted fields are: encrypted triage summary/hash, encrypted current profile snapshot/hash, allowlisted attribution snapshot, response window/deadline, trigger/risk/session/patient/clinic IDs, status/timestamps, plus normalized provenance rows (`lines 16-101`).
- `src/features/staff/service.ts:46-116` returns the trigger message, risk reason/confidence, current profile snapshot, attribution, provenance, and prior clinician responses to the authorized review page.
- The snapshot contains only each item’s current revision (`src/features/escalation/payload.ts:10-19`), not correction history or contradiction flags. Validation does not decrypt and schema-validate the summary/profile payload in PostgreSQL.

### What breaks first

The nurse receives a usable complaint/risk/trigger/current-profile handoff, but cannot see medication correction history or explicit contradictions at a glance. She may need to inspect other records or ask the patient. Later message deletion is incompatible with `ON DELETE RESTRICT` provenance references, while a missing UI target would produce a silent anchor failure.

### Missing

- Contradiction/uncertainty flags.
- Selected correction history or structured medication status history.
- Quoted-span integrity data.
- A defined retention policy for snapshots versus source messages.
- Strong decoded payload validation.

### Proposed fix

Version a strict escalation payload DTO, include compact medication/allergy conflict and correction history, and validate it before encryption plus via hashes/normalized provenance in SQL. Preserve minimal clinical facts and exclude all contact values. Resolve source evidence through an integrity-aware endpoint with an explicit unavailable state.

### Files affected

- `src/features/escalation/payload.ts`
- `src/features/escalation/service.ts`
- `src/types/escalation.ts`
- `src/features/staff/service.ts`
- `app/staff/escalations/[escalationId]/page.tsx`
- New payload-version/conflict/provenance migration.

### Required test

`tests/scenarios/test_scenario_18_cold_handoff_payload.test.ts` — snapshot the literal field allowlist, reject foreign/invalid provenance and oversize payloads, prove corrections/conflicts are visible, and prove contact/expired guest-only data are absent.

## Scenario 19 — “No known allergies” contradicts a penicillin rash

Status: PARTIAL

### Current implementation

- `src/features/memory/extract.ts:59-82` creates a specific allergy under its substance key and “No known allergies” under the separate key `none_known`.
- `supabase/migrations/202609030005_living_memory.sql:153-204` groups revisions by `(patient, kind, canonical_key)` and advances each key independently.
- No contradiction function, conflict table/status, medication-dose comparator, or escalation rule exists.
- `src/features/escalation/payload.ts:10-27` includes both current facts without marking that they conflict.

### What breaks first

After the two messages, Living Memory shows both `none_known` active and penicillin active. Nobody decides or flags the inconsistency. Reversing message order produces the same unsafe dual-active state, and the clinician has to notice it manually.

### Missing

- Deterministic conflict groups for allergy-none versus named allergy, medication active/stopped ambiguity, and same-medication dose changes.
- Append-only conflict provenance and resolution state.
- A clinician-visible warning and conservative handoff/risk behavior.

### Proposed fix

Add an append-only `memory_conflicts` record referencing both revisions. Deterministically flag safety-critical contradictions and require clarification/human review; do not silently choose last-write-wins. Keep both source statements visible and let a later explicit correction create a resolution revision/event.

### Files affected

- `src/features/memory/extract.ts` or a new `src/features/memory/conflicts.ts`
- `src/features/memory/service.ts`
- New conflict migration and generated `src/types/database.ts` updates.
- `src/types/memory.ts`
- `src/features/escalation/payload.ts`
- Patient and staff profile components.

### Required test

`tests/scenarios/test_scenario_19_safety_critical_contradictions.test.ts` — test both orders for allergy-none/penicillin rash, medication state, and dosage conflict; assert neither is silently discarded, a conflict is shown/escalated, and explicit resolution retains both sources.

## Scenario 20 — Clinic B and cross-tenant isolation

Status: PARTIAL

### Current implementation

- Tenant ownership is represented throughout by `clinic_id` and composite constraints. Staff identity derives from the Supabase session, not a request role/clinic: `src/features/staff/auth.ts:22-43` queries memberships for `auth.uid()`.
- Queue/review reads use the session-bound client and RLS at `src/features/staff/service.ts:10-17,46-71`; mutation RPCs use session identity at lines 119-147.
- `has_active_clinic_membership` and `has_consented_patient_access` at `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:114-145` bind `auth.uid()`, clinic membership, and current consent. RLS at lines 512-590 uses those functions.
- Queue/mutation functions validate patient ownership or same-clinic membership; direct writes are revoked at lines 503-606.
- Service-role clients do exist in guest, lead, memory, patient-chat, patient-session, and staff services. Current staff service-role lookups occur only after an RLS-authorized record/membership and are scoped—for example authors are filtered by both ID and `escalation.clinic_id` at `src/features/staff/service.ts:70-76`. This is safer than routing the whole dashboard through service role, but remains application-enforced in several internal helpers.
- `tests/unit/escalation-rbac-contract.test.ts` inspects SQL strings. There is no second-clinic hosted integration test proving zero rows.

### What breaks first

Static tracing indicates Clinic B should see only its own rows and adding it is a data/configuration operation, not a schema change. However, the required proof is absent. A future internal caller can pass an unauthorized session ID to a service-role memory/helper function and bypass RLS; if that helper is exposed incorrectly, cross-clinic PHI could be returned before the SQL policies help.

### Missing

- Real Patient A/Patient B/Clinic A/Clinic B negative integration tests against hosted Supabase.
- A central authorization-before-admin-read abstraction or removal of avoidable admin reads.
- CI guard against importing the admin client into public route modules.

### Proposed fix

Add two-clinic integration fixtures and assert zero-row/forbidden behavior for every table and RPC. Prefer the session client end-to-end; where service role is necessary, accept only an authorization capability/internal principal produced by a prior RLS check and require clinic scoping in the same query.

### Files affected

- New hosted integration test setup and scenario test.
- `src/features/memory/service.ts`
- `src/features/patient-chat/service.ts`
- `src/features/patient-sessions/service.ts`
- `src/features/staff/auth.ts`
- `src/features/staff/service.ts`
- Potential tightening migration after test results.

### Required test

`tests/scenarios/test_scenario_20_cross_clinic_isolation.test.ts` — create two clinics, patients, memberships, consents, messages, memories, and escalations; prove every Clinic B read of Clinic A returns zero/forbidden and every mutation fails.

## Scenario 21 — Provenance points to evidence that changed or disappeared

Status: PARTIAL

### Current implementation

- Memory provenance stores only `source_message_id`, optional `model_run_id`, fact value hash, and supersedes pointer: `supabase/migrations/202609030005_living_memory.sql:30-43`.
- Source membership is verified when the revision is inserted at lines 140-150.
- Message rows have a content hash, but memory revisions do not copy the source content hash, offsets, or encrypted quoted span.
- `app/components/patient-chat.tsx:227-235` resolves provenance as an in-page `#message-{id}` anchor. It does not verify content integrity or display a missing-evidence state.
- Users cannot directly update messages under current grants, but there is no append-only trigger for message content. Service-role code or a later migration could mutate it.
- Message and revision foreign keys use `ON DELETE RESTRICT`. This prevents a dangling database pointer, but can also make a retention purge fail rather than fulfilling deletion.

### What breaks first

If the source message is not present in the loaded page, the link silently goes nowhere. If privileged code changes content, the UI highlights the changed sentence without detecting hash mismatch. If retention tries to purge a referenced source, the delete can fail because provenance restricts it; referential integrity is preserved at the cost of the promised purge.

### Missing

- Source content hash captured on the revision.
- Quoted-span offsets/normalization version or encrypted minimal evidence snapshot.
- Message versioning/immutability and an explicit unavailable/redacted source state.
- A reconciled deletion-versus-clinical-provenance policy.

### Proposed fix

Store the source message hash, normalization version, and encrypted minimal quoted span (or immutable message-version ID) on each revision. Resolve through an authorized endpoint that verifies the hash and returns `verified`, `changed`, or `unavailable`; never silently highlight mismatched text. Define which converted clinical evidence must be retained and which abandoned guest data must be destroyed.

### Files affected

- New message-version/provenance-integrity migration.
- `src/features/memory/service.ts`
- `src/types/memory.ts`
- `src/types/database.ts`
- `app/components/patient-chat.tsx`
- `src/features/escalation/payload.ts`
- Staff review UI.

### Required test

`tests/scenarios/test_scenario_21_provenance_integrity.test.ts` — prove exact-span resolution, hash mismatch detection, explicit unavailable behavior, tenant authorization, and defined retention behavior for referenced guest and patient messages.

## P0 Implementation Reassessment — 10 September 2026

This section supersedes the pre-P0 implementation descriptions above for Scenarios 04 and 08–15 and records the executable paths added during remediation. Scenario 20 remains PARTIAL because repository contract tests are not a substitute for a real two-clinic hosted-Supabase test.

### Scenario 04 — PARTIAL

The executable staff path remains session-bound and consent-gated in `src/features/staff/service.ts`, while direct guest-message access remains revoked by `supabase/migrations/202609030001_guest_chat.sql`. `tests/scenarios/test_scenario_04_guest_visibility.test.ts` now checks the conversion value gate, revoked guest reads, current-consent requirement, and exclusion of required-but-unsent escalations. This is still PARTIAL because the test inspects repository contracts rather than authenticating real guest, patient, and staff principals against hosted Supabase.

### Scenario 08 — SURVIVES

`assessDeterministicRisk` at `src/features/risk/policy.ts:58` consumes the shared emergency rules, and `maxRiskDecision` at line 79 explicitly computes the higher of deterministic and model decisions. `createPatientTurn` computes the floor from the untouched request at `src/features/patient-chat/service.ts:41`, before its reservation at line 44, and passes it into `runPatientSafetyPipeline` at line 71. Pipeline composition is called at `src/features/patient-chat/pipeline.ts:162,183`; a High returns local emergency guidance without invoking the provider. Redaction errors, parsing failures, timeouts, and provider failures preserve that result. `tests/scenarios/test_scenario_08_unlowerable_emergency_floor.test.ts` proves provider suppression for High, Medium-over-Low precedence, and emergency copy on guest redaction failure.

### Scenario 09 — SURVIVES

`src/features/risk/emergency-rules.ts:1-46` is the single versioned English, Malay, Simplified Chinese, and Traditional Chinese emergency floor used by guest and patient policy. `tests/scenarios/test_scenario_09_multilingual_emergency_floor.test.ts` exercises mixed English/Malay, full Malay, and both Chinese scripts through both policy surfaces and proves local 999 guidance with zero model calls. The rule corpus still requires clinical and native-speaker validation before production use; that validation limitation does not change the executable result for the feedback scenario.

### Scenario 10 — SURVIVES

`createGuestTurn` at `src/features/guest-chat/service.ts:184-302` and `createPatientTurn` at `src/features/patient-chat/service.ts:41-117` assess raw text first, then reserve the idempotent turn using `SAFETY_RESERVATION_PLACEHOLDER`. Guest redaction at line 225 precedes the provider call at line 246; the patient pipeline begins at `src/features/patient-chat/pipeline.ts:47` and redacts before its provider callback. The new `seal_guest_message` and `seal_patient_message` functions at `supabase/migrations/202609100001_p0_safety_boundaries.sql:47,100` replace the placeholder with encrypted raw content only after the risk/redaction/provider/output pipeline returns; the trigger at lines 22-44 rejects assistant replies to unsealed sources. `src/features/redaction/redact.ts:71-76,116-132` redacts and verifies compact and hyphenated Malaysian MyKad values. `tests/scenarios/test_scenario_10_risk_redaction_order_mykad.test.ts` proves provider redaction, fail-closed behavior, and source-order contracts for both guest and patient services.

### Scenario 11 — PARTIAL

Both provider clients call `fetchWithProviderTimeout` at `src/server/openai/guest-response.ts:65` and `src/server/openai/patient-response.ts:59`, with only redacted context and `store: false`. `src/server/logging/sanitize.ts:11-22` applies runtime allowlists to audit actions, codes, resource types, UUIDs, and SHA-256 hashes before `src/server/logging/audit.ts:7-13` writes them. `tests/scenarios/test_scenario_11_no_phi_egress.test.ts` uses PHI canaries against provider-source and logging contracts. The status remains PARTIAL because hosted request-body/APM logging and OpenAI contractual retention controls cannot be proven from this repository.

### Scenario 12 — PARTIAL

`supabase/migrations/202609100001_p0_safety_boundaries.sql:1-189` enforces non-PHI reservation/sealing boundaries. `supabase/migrations/202609100002_guest_retention_schedule.sql:1-18` independently schedules `expire_lead_sessions()` hourly, so an extension/scheduler deployment issue does not couple retention setup to the core message safety transaction. Existing consent-aware staff RLS and guest rate limits remain in force. `tests/scenarios/test_scenario_12_guest_boundary_retention.test.ts` checks revokes, consent conditions, rate limits, and the cron contract. The status remains PARTIAL until both migrations are applied to hosted Supabase and a real expired fixture proves deletion and records observable cleanup success/failure.

### Scenario 13 — SURVIVES

`fetchWithProviderTimeout` at `src/server/openai/provider-timeout.ts:8-29` owns an `AbortController`, aborts at the configured deadline, maps the result to a non-sensitive `ProviderRequestTimeoutError`, and is called by both OpenAI clients. `tests/scenarios/test_scenario_13_provider_timeout.test.ts` advances a fake clock and proves a hung fetch is aborted at 15 seconds. The service then returns stable local degraded-mode copy. A whole-route/browser deadline is still a reliability improvement, but an OpenAI provider hang no longer produces the feedback scenario's 45-second spinner.

### Scenario 14 — PARTIAL

`runPatientSafetyPipeline` at `src/features/patient-chat/pipeline.ts:178-192` and the provider-failure branch in `src/features/guest-chat/service.ts:256-266` return explicitly labelled, local safety-only copy when the provider fails, while shared emergency rules return 999 guidance without provider involvement. `tests/scenarios/test_scenario_14_provider_outage_degraded_mode.test.ts` proves provider-error details are not released and a Malay emergency remains High during outage. This remains PARTIAL because there is no shared circuit breaker, operational outage state, or alerting; every eligible request still attempts the unavailable provider before degrading.

### Scenario 15 — SURVIVES

`src/features/risk/output-safety.ts:7-27` is a called, deterministic release gate shared by guest and patient flows. The patient invocation is at `src/features/patient-chat/pipeline.ts:160`; the guest invocation occurs before completion in `src/features/guest-chat/service.ts:270-280`. It blocks direct and hedged diagnostic claims, comparative diagnosis exclusions such as “not cardiac,” medication instructions, reassurance, and wait-and-see advice. Unsafe output is replaced wholesale with local safe copy. `tests/scenarios/test_scenario_15_output_diagnosis_gate.test.ts` covers the judges' gastritis/cardiac wording plus paraphrases on both surfaces.

### Scenario 20 — PARTIAL

`loadMemoryProfileForSession` at `src/features/memory/service.ts:17-65` uses the request's session-bound Supabase client so patient/staff-visible reads execute RLS rather than service-role bypass. The remaining service-role author lookup at `src/features/staff/service.ts:73-76` is scoped by both author and escalation clinic. `tests/scenarios/test_scenario_20_cross_clinic_isolation.test.ts` checks these executable/static contracts. A two-clinic hosted negative integration test is still required before this can honestly be marked SURVIVES.

## Living Memory Implementation Reassessment — 10 September 2026

This section supersedes the pre-implementation observations above for Scenarios 16, 17, 19, and 21. The later identity/consent reassessment records the completed strict validation for Scenario 18.

### Scenario 16 — SURVIVES

`extractDeterministicMemory` at `src/features/memory/extract.ts:13-65,180-193` recognizes `it`, `that`, `medication`, and `medicine` only when exactly one medication can be resolved. “I take Advil” → “Actually I stopped it last week” → “Actually I started taking it again” therefore produces active, stopped, and active proposals under the same `advil` key while preserving the verbatim stopped timeline. Ambiguous multi-medication pronouns still produce no guess. The existing writer at `supabase/migrations/202609030005_living_memory.sql:153-204` inserts each proposal as a new revision, points `supersedes_revision_id` at the former current revision, and never updates historical revision content. `tests/scenarios/test_scenario_16_correction_chain.test.ts` executes the exact correction and correction-of-correction chain and verifies all three original source IDs.

### Scenario 17 — SURVIVES

The production conversion route calls `bootstrapGuestMemory(patientSessionId)` after the idempotent database conversion at `app/api/conversion/route.ts:35-58`. The writer at `src/features/memory/service.ts:166-236` loads original guest messages in chronological order, extracts with `sourceMessageId: message.id` at line 191, writes through `apply_patient_memory`, and records success/failure through `record_memory_bootstrap_result`. `supabase/migrations/202609100003_living_memory_integrity.sql:1-12,156-183` adds pending/completed/failed status and atomic attempt accounting. Partial writes safely retry because the base memory writer is idempotent per item/source message, and the conversion cookie is deleted only after bootstrap succeeds. `src/features/patient-sessions/service.ts:120` detects carried guest messages; `app/patient/sessions/[sessionId]/page.tsx:28-55` and `app/components/patient-chat.tsx:101` explicitly say the concern is already present and ask only for additions or corrections. `tests/scenarios/test_scenario_17_guest_memory_conversion.test.ts` covers original GuestMessage provenance, the called writer/status contract, and no-repeat intake copy.

### Scenario 19 — PARTIAL

`src/features/memory/extract.ts:82-97` now recognizes reaction language such as “Penicillin gave me a rash,” while medication extraction preserves explicit doses. `supabase/migrations/202609100003_living_memory_integrity.sql:53-140` creates append-only `memory_conflicts` linking both revisions and deterministically flags allergy-presence, medication-status, and same-medication dosage disagreements. It does not overwrite either revision. `src/features/memory/service.ts:49-127` loads conflicts into each authorized profile, and `src/features/escalation/payload.ts:10-69` freezes open conflicts, compact correction history, and both supporting revision IDs into the handoff. The patient alert is at `app/components/patient-chat.tsx:222-243`; the clinician warning is in `app/staff/escalations/[escalationId]/page.tsx:38-41`. `tests/scenarios/test_scenario_19_safety_critical_contradictions.test.ts` covers the allergy example, dosage changes, all three database conflict classes, and handoff provenance. The status remains PARTIAL until the migration is exercised against hosted Supabase and an explicit authorized conflict-resolution event is implemented; open conflicts are intentionally never auto-resolved.

### Scenario 21 — PARTIAL

The smallest credible alternative to a full message-version subsystem is implemented. `supabase/migrations/202609100003_living_memory_integrity.sql:14-51` backfills and then captures `source_content_sha256` plus an encrypted immutable `source_snapshot_ciphertext` in the same insert as every future revision. The pre-existing append-only trigger prevents snapshot mutation. `loadMemoryProfileForSession` recomputes the current hash from decrypted authorized message content at `src/features/memory/service.ts:42-58`; `resolveSourceIntegrity` in `src/features/memory/provenance.ts:3-9` returns `verified`, `changed`, or `unavailable`. `app/components/patient-chat.tsx:239-243` links only verified evidence and renders the immutable snapshot for changed/unavailable evidence. The clinician handoff carries the integrity state, bounded snapshot, history, and normalized revision pointers. `tests/scenarios/test_scenario_21_provenance_integrity.test.ts` executes all three integrity outcomes and checks the capture/UI contracts. This remains PARTIAL because source-message deletion still uses `ON DELETE RESTRICT`; the encrypted snapshot improves mutation resilience but requires an explicit clinical-retention versus erasure policy before referenced converted evidence can be purged.

### Provenance storage trade-off

The implementation stores the original encrypted message ciphertext and SHA-256 hash on each memory revision rather than adding a separate message-version aggregate. This is smaller, transactional, and keeps old evidence resolvable even if privileged code later changes the source row. It duplicates encrypted clinical content and can extend its effective retention, so snapshots are protected by the same patient/same-clinic-consent RLS as memory history and must be included in retention/erasure policy. A future full versioning system would deduplicate snapshots and support explicit redacted/unavailable versions, but is not required for this prototype's mutation-resilience scenario.

## Identity, Consent, Attribution and Escalation Reassessment — 10 September 2026

This section supersedes the earlier implementation observations for Scenarios 02, 05, 07, and 18. Status remains conservative where hosted configuration or database integration proof is external to this repository.

### Scenario 02 — PARTIAL

The social-comment simulator captures an optional phone at `app/components/lead-session-starter.tsx:67,132-138`; `src/features/lead-sessions/service.ts:162-177` normalizes, encrypts, hashes, and writes it through `create_lead_session_v2`. That writer stores the protected phone pair on LeadSession at `supabase/migrations/202609100004_identity_consent_escalation.sql:1-54`. The repository contains a real no-email route using Supabase Phone Auth: `app/api/auth/phone/start/route.ts:27` calls `signInWithOtp`, and `app/api/auth/phone/verify/route.ts:24` verifies the SMS OTP. `src/server/auth/user.ts:11-19` accepts either a confirmed email or confirmed phone; it does not accept a social handle. The UI states this boundary explicitly at `app/components/auth-form.tsx:122-125`. The production conversion route calls `convert_lead_to_patient_v2` at `app/api/conversion/route.ts:43-58`. Its writer in `supabase/migrations/202609100004_identity_consent_escalation.sql:74-267` accepts either verified identity, requires a phone-auth conversion phone to match the confirmed Supabase number, preserves the originally captured phone as active only when it matches the current number (otherwise as inactive history), and carries the encrypted lead social handle into contact history with an external reference to the originating LeadSession at lines 197-219. No contact value is copied into escalation attribution. `tests/scenarios/test_scenario_02_phone_social_identity.test.ts` verifies the code and persistence contract.

**Deployment status:** Phone Auth is disabled in the submitted hosted Supabase environment. The available Twilio account is inactive, a replacement account could not complete 2FA, and no alternative provider was activated and tested before the deadline. Therefore SMS OTP delivery is not claimed or demonstrated. The working demo path is verified email/password. Scenario 02 remains PARTIAL: its implementation is ready for provider integration, but it does not survive in the current deployed environment until a supported SMS provider is configured and the hosted end-to-end test passes. No Instagram authentication is claimed.

### Scenario 05 — PARTIAL

`patient_sessions` now stores `acquisition_identity_level`, `current_identity_level`, actual authentication method, and verified state at `supabase/migrations/202609100004_identity_consent_escalation.sql:55-71`. Conversion writes the original lead identity and immutable `origin_lead_session_id` at lines 244-252, while funnel events preserve acquisition identity and put current identity in metadata through the trigger at lines 368-393. Clinic ownership remains on every LeadSession, PatientSession, funnel event, and escalation row. On queue, `enrich_escalation_identity` at lines 342-366 adds the two identity meanings to the attribution allowlist and removes `email`, `phone`, and `social_handle` keys. The staff DTO returns `clinicId` and the clinician view shows original versus verified current identity at `src/features/staff/service.ts:80-112` and `app/staff/escalations/[escalationId]/page.tsx:47`. `tests/scenarios/test_scenario_05_attribution_minimisation.test.ts` rejects PII additions. The scenario remains PARTIAL because its separate live, clinic-scoped conversion-statistics/zero-state requirement is not implemented and the migration still needs hosted integration proof.

### Scenario 07 — PARTIAL

Clinical/transactional sharing and marketing are separate inputs and separate append-only `consent_events`. The marketing checkbox at `app/components/consent-form.tsx:69-76` is optional and unchecked by default; the clinical checkbox remains required. Each has independent policy/notice constants in `src/features/consent/constants.ts:1-4`, and the conversion route verifies both sets before invoking the transactional writer. The writer only emits a marketing grant when the optional checkbox is true at `supabase/migrations/202609100004_identity_consent_escalation.sql:232-242`. Authenticated grants and withdrawals use `record_marketing_email_consent` at lines 271-319; current consent is independently queryable, newest-event-wins, and defaults false through `has_current_marketing_email_consent` at lines 321-340. The server route is `app/api/consent/marketing/route.ts:1-41`. `tests/scenarios/test_scenario_07_separate_consents.test.ts` covers default-off separation, versions, withdrawal architecture, and the false zero state. This remains PARTIAL pending hosted database integration proof and a patient-facing preferences control that calls the revocation endpoint; the endpoint and append-only writer are operational rather than placeholders.

### Scenario 18 — SURVIVES

The actual send path loads the trigger, deterministic/model-composed risk, and current Living Memory, then calls `buildEscalationPayload` in `src/features/escalation/service.ts:43-83`. The payload includes a bounded presenting-complaint excerpt, risk level/reason/confidence, medication current state plus correction history, open allergy/medication/dosage contradictions, and normalized message/revision provenance in `src/features/escalation/payload.ts:5-74`. `src/features/escalation/schema.ts:3-48` is a strict allowlist for summary, profile, provenance-bearing fields, and minimized attribution; unknown contact fields fail parsing. The same schemas validate before encryption and after authorized clinician-side decryption at `src/features/staff/service.ts:80-83,175-181`. Acquisition channel/campaign and original/current identity are visible, while phone/email/social-handle values remain only in protected identity/contact records. `tests/scenarios/test_scenario_18_cold_handoff_payload.test.ts` proves bounded cold-handoff content and rejects contact PII or malformed fields; existing Scenario 19 and 21 tests prove correction, contradiction, and provenance content.

## Cross-cutting required build properties

- **Live-query statistics: DOES NOT.** There is a populated `funnel_events` model, but no aggregation service, staff API, or dashboard. `README.md:190` admits this. Scenario 05’s proposed live, clinic-scoped zero-safe aggregate is the smallest repair.
- **Voice-ready schema: PARTIAL.** `supabase/migrations/202609030001_guest_chat.sql:39-40` adds nullable `audio_recording_id` and `audio_transcript_id`, but there are no referenced audio/transcription entities, ownership constraints, consent, storage policy, or ingestion path. `TECHNICAL_BRIEF.md:102-106` accurately describes these as future work.
- **Declarative channel rules: SURVIVES for the four simulated channels.** `supabase/migrations/202609020001_phase1_foundation.sql:78-90` owns the rule table; `src/features/lead-sessions/service.ts:66-91` selects by clinic, source, identity level, local time of day, active flag, and priority; `app/components/guest-chat.tsx:161-197` renders the selected strategy. Adding a clinic/rule is data configuration. Real social integrations remain deferred.
- **Response expectation tracking: PARTIAL overall.** Per-clinic min/max and `response_expected_by` are persisted, but there is no overdue worker, notification, or delivery receipt (Scenario 01).
- **Scenario-based automated proof: PARTIAL.** Scenario-named tests now cover Scenarios 04, 08–17, 19–21 where implemented. The remaining scenarios and hosted-Supabase/browser paths do not yet have equivalent executable proof.

## Priority Implementation Plan

Assumption for scheduling: “Friday at 10:00 AM” means Friday, 11 September 2026 at 10:00 Asia/Kuala_Lumpur. This leaves roughly a day and a half from the audit date. The order below favors changes that close multiple scenarios at once and limits high-risk schema churn.

### P0 — Safety/security/data-isolation issues

1. **Completed in repository: deterministic safety floor** (Scenarios 08, 09, 13, 14). Shared English/Malay/Chinese rules run on raw input first; deterministic High skips the provider; explicit maximum-risk composition and provider timeout tests are present.
2. **Completed in repository: patient-facing output gate** (Scenario 15). The exact judge wording and an adversarial diagnosis/reassurance corpus are blocked with deterministic replacement.
3. **Partially completed: clinic isolation and consent boundary** (Scenarios 04, 12, 20). Avoidable service-role memory reads were removed and scenario contract tests were added. Hosted two-clinic negative RLS/RPC tests remain mandatory.
4. **Partially completed: guest retention** (Scenarios 03, 12, 21). Hourly cleanup is declared, but hosted execution, monitoring, and the deletion-versus-provenance policy remain unproven.
5. **Partially completed: provider/logging evidence** (Scenarios 10, 11). Runtime log sanitisation, non-PHI reservations, explicit provider deadlines, and canary tests are present. Deployment logging and provider contractual retention still require external verification.

### P1 — Core trust and continuity issues

1. **Expose clinician responses to patients and ship one transactional channel** (Scenario 01). Use an outbox, verified email, neutral notification copy, authenticated deep link, attempts/receipts, and overdue query. Do not attempt four channels.
2. **Completed in repository; phone deployment blocked externally: contact/identity without payload over-retention** (Scenarios 02, 05). Phone OTP, encrypted social/phone contact continuity, original/current identity separation, and minimized escalation attribution are implemented. The submitted environment uses email/password because no operational SMS provider is configured.
3. **Partially completed: safety-critical memory conflict detection** (Scenarios 18, 19). Allergy-presence, medication-state, and dose conflicts are append-only and included in the handoff. Hosted execution proof and an explicit resolution event remain.
4. **Completed in repository: exact medication correction language** (Scenario 16). Pronouns, “last week,” ambiguous references, restart, and correction chains are covered.

### P2 — Reliability/data-integrity issues

1. **Completed in repository: retryable guest-memory bootstrap** (Scenario 17). Conversion calls the writer, preserves GuestMessage IDs, records completion state/attempts, and does not claim successful continuation before bootstrap completes.
2. **Completed for Scenario 18; provenance retention remains partial for Scenario 21.** Strict before/after-decryption payload schemas, compact correction/conflict history, immutable source snapshots, hash verification, and explicit changed/unavailable states are implemented.
3. **Add total request/client deadlines and outage state** (Scenarios 13, 14), then display an explicit bounded degraded mode.
4. **Completed in repository; hosted proof/preferences UI pending: separate marketing consent** (Scenario 07). Default-off conversion UI, append-only writer, withdrawal endpoint, independent versions, and current-consent query are implemented.
5. **Add live funnel aggregates with an honest zero state** (cross-cutting/Scenario 05).

### P3 — UX/completeness improvements

1. Add explicit expired-link explanation and fresh-start flow (Scenario 03).
2. Add grounded post-conversion suggestion chips; profile-import state and no-repeat continuity copy are implemented (Scenario 17).
3. Further refine the clinician cold-handoff layout; conflicts, corrections, and evidence integrity states are now visible (Scenarios 18, 21).
4. Add the remaining scenario-named browser tests and update README/technical brief/demo script with honest statuses.
5. Extend voice readiness only at the schema boundary: audio artifact, transcription run, consent, ownership, and retention entities. Do not build live Voice AI before the text safety boundary is proven.

## Final assessment

1. **SURVIVES: 9 scenarios** — 06, 08, 09, 10, 13, 15, 16, 17, 18.
2. **PARTIAL: 11 scenarios** — 02, 03, 04, 05, 07, 11, 12, 14, 19, 20, 21.
3. **DOES NOT: 1 scenario** — 01.
4. **Highest-risk remaining problems:** clinician replies do not reach patients after tab closure; hosted cross-clinic isolation and the new conflict triggers lack real negative/integration proof; open contradictions have no explicit authorized resolution event; cleanup execution and provenance-aware deletion are not operationally reconciled; and provider/log-retention controls cannot be proven from application code alone.
5. **Recommended implementation order after these fixes:** apply migrations through `202609100004` in hosted Supabase → keep the demonstrated email/password path stable → run two-clinic/consent/conflict/deletion integration tests → patient reply outbox and secure deep link → configure and test a supported SMS provider before exposing Phone Auth → explicit conflict-resolution events and retention policy → live metrics and UX.
6. **Not realistic to complete production-credibly before the deadline:** all-channel push/SMS/WhatsApp/email delivery (ship one transactional channel); a real Instagram authentication/integration (phone OTP is implemented instead); clinical validation of the trilingual rules across dialects; provider Zero Data Retention approval/legal contracting; a full immutable quoted-span/message-version system; production Voice AI; and comprehensive E2E/integration coverage for all 21 scenarios. These remain explicitly PARTIAL/DOES NOT rather than being represented by schema placeholders or UI copy.

## Continuity and Re-engagement Reassessment — 10 September 2026

This section supersedes the earlier implementation observations and final count for Scenarios 01, 03, and 06. Status remains conservative until the new migration, VAPID configuration, and browser flows are exercised against the hosted deployment.

## Scenario 01 — The clinician replies after the patient closes the tab

Status: PARTIAL

### Current implementation

`supabase/migrations/202609100005_continuity_reengagement.sql:1-76` adds `clinician_response_at`, creates a PHI-free `notification_jobs` outbox plus attempt records, and enqueues one job in the same transaction as every `clinician_responses` insert. The existing structural deadline remains `response_expected_by`; it is computed from the clinic configuration when the escalation is queued rather than from UI copy. `app/api/staff/escalations/[escalationId]/responses/route.ts:8-24` persists the response first and then invokes `deliverResponseNotification`. `src/features/notifications/service.ts:38-93` performs the only real outbound transport: optional Web Push with a ten-second timeout, neutral content, encrypted subscription resolution, attempt/outcome persistence, and 404/410 subscription deactivation. It never reports delivery when VAPID is absent, no subscription exists, or the provider call fails.

`src/features/notifications/payload.ts:1-8` creates a neutral return URL for the exact session/escalation. `app/login/page.tsx:7-29`, `app/components/patient-return-login.tsx:8-61`, `app/api/auth/patient-login/route.ts:15-48`, and `src/features/auth/return-path.ts:1-5` implement re-authentication with a strict patient-conversation-only return-path allowlist. The deep link is not a bearer credential. The destination still calls `getVerifiedUser()` and reads through patient RLS in `src/features/patient-sessions/service.ts:17-37`. `src/features/escalation/service.ts:21-65` now loads authorized clinician responses, and `app/components/patient-chat.tsx:160-165` displays the persisted response and actual first-response timestamp.

`app/components/push-notification-control.tsx:5-72`, `app/api/patient/push-subscriptions/route.ts:10-38`, and `public/sw.js:1-18` provide explicit patient opt-in, server persistence, neutral notification display, and a same-origin click boundary. Unsupported/unconfigured browsers are told to return manually. `app/components/escalation-actions.tsx:17-54` shows the staff member the real delivery outcome instead of claiming notification success.

### What breaks first

If VAPID is not configured, the patient has not opted in, the browser lacks Push support, or delivery fails, no lock-screen/device alert arrives. The clinician response is still committed and becomes visible when the authenticated patient returns to the exact conversation. A signed-out patient can now re-authenticate without a guest cookie. No response is lost merely because notification delivery fails.

### Missing

- Hosted migration execution and an end-to-end push receipt on a supported browser over HTTPS.
- A scheduled retry/lease worker and operator view for `pending` or `failed` jobs; the current request performs one immediate attempt.
- An overdue workflow based on `response_expected_by`; the timestamp is honest and queryable, but nobody is automatically paged when it passes.
- Transactional email, SMS, and WhatsApp transports. They are intentionally not claimed.

### Proposed fix

Before the deadline, apply migration `202609100005`, configure a generated VAPID key pair, and run one two-browser hosted acceptance test. If time remains, add a small authenticated/cron worker that leases pending jobs and retries with bounded backoff; do not add another channel without an operational provider account.

### Files affected

- `supabase/migrations/202609100005_continuity_reengagement.sql`
- `src/features/notifications/*`
- `app/api/patient/push-subscriptions/route.ts`
- `app/api/staff/escalations/[escalationId]/responses/route.ts`
- `app/components/push-notification-control.tsx`
- `app/components/escalation-actions.tsx`
- `app/login/page.tsx`
- `app/components/patient-return-login.tsx`
- `app/api/auth/patient-login/route.ts`
- `app/patient/sessions/[sessionId]/page.tsx`
- `app/components/patient-chat.tsx`
- `public/sw.js`

### Required test

`tests/scenarios/test_scenario_01_response_delivery.test.ts` proves the transactional outbox contract, neutral payload, strict same-application return path, re-authentication path, patient authorization call, response read, and explicit non-delivery outcomes. A hosted browser/RLS test is still required before this can become SURVIVES.

## Scenario 03 — Cross-device guest return after expiry

Status: PARTIAL

### Current implementation

`app/api/lead-sessions/recovery-link/route.ts:10-24` now places the opaque recovery credential in the URL fragment rather than an HTTP query. `app/recover/page.tsx:1-14` sets `no-referrer`; `app/components/guest-recovery.tsx:8-29` removes the fragment immediately and exchanges it by POST. `app/api/lead-sessions/recover/route.ts:14-25` installs a newly rotated HttpOnly cookie only for an active session. `src/features/lead-sessions/service.ts:237-261` distinguishes active, expired, purged, and invalid state and invokes the narrow rotation RPC.

`supabase/migrations/202609100005_continuity_reengagement.sql:143-202` stores only a recovery-token hash and lifecycle timestamps in tombstones, rotates the token under row lock, deletes abandoned guest messages at expiry, clears guest context/contact/recovery fields, and later marks the tombstone purged. The hourly job already declared in `supabase/migrations/202609100002_guest_retention_schedule.sql:1-18` calls the replaced function. The UI intentionally tells an expired visitor that the recovery window ended and cleanup is scheduled; a purged visitor is told cleanup completed. Neither state silently hides the conversation or claims it can be recovered.

### What breaks first

An active link created by the new path can resume on another device once, after which the copied credential is obsolete. An expired link cannot reopen content and explains why. If hosted cron has not run yet, the UI does not claim deletion has already completed. After cleanup, the purged state confirms that the guest conversation/contact content cannot be restored. Links generated by the older query-string implementation are not upgraded automatically.

### Missing

- Hosted proof that `pg_cron` is enabled, the replacement cleanup function is installed, and a real expired fixture is deleted.
- Monitoring/alerting for failed cleanup jobs.
- Browser E2E coverage across two physical/device profiles and migration handling for previously issued legacy links.
- A reconciled policy for converted guest evidence, which is retained as consented clinical provenance rather than treated as abandoned guest data.

### Proposed fix

Apply the migration, verify the cron job in hosted Supabase, and run active/expired/purged fixtures with synthetic data. Keep legacy recovery links invalid rather than accepting query credentials that may remain in access logs; document the one-time transition.

### Files affected

- `supabase/migrations/202609100005_continuity_reengagement.sql`
- `src/features/lead-sessions/service.ts`
- `app/api/lead-sessions/recovery-link/route.ts`
- `app/api/lead-sessions/recover/route.ts`
- `app/recover/page.tsx`
- `app/components/guest-recovery.tsx`

### Required test

`tests/scenarios/test_scenario_03_expired_cross_device_recovery.test.ts` proves fragment/POST exchange, token rotation, tombstone states, deletion/anonymisation contract, and distinct user-facing outcomes. Hosted cron and two-device browser tests remain required before SURVIVES.

## Scenario 06 — An earned-email promise without a mail transport

Status: SURVIVES

### Current implementation

There is no transactional mail client, SMTP credential, email provider API, SMS sender, or WhatsApp sender in the executable repository. Application surfaces do not offer or claim an emailed conversation summary. `app/components/push-notification-control.tsx:16-60` exposes Web Push only when the browser and deployment are actually configured and describes delivery as an attempt, not a guarantee. `README.md` and `TECHNICAL_BRIEF.md` explicitly state the transport boundary.

### What breaks first

Nothing falsely reports earned-email success because no earned-email action is exposed. Without configured Web Push, the patient sees that device alerts are unavailable and is directed to check the authenticated conversation manually.

### Missing

Earned email remains an intentionally omitted optional feature. Implementing it later requires a real transactional provider, verified destination resolution, purpose-specific consent/legal review, neutral templates, outbox attempts/receipts, bounce handling, and hosted delivery proof.

### Proposed fix

No pre-deadline implementation is needed. Preserve the capability/copy test and reject any email-summary UI until a working provider path exists.

### Files affected

- `tests/scenarios/test_scenario_06_no_unearned_email_promise.test.ts`
- `README.md`
- `TECHNICAL_BRIEF.md`

### Required test

`tests/scenarios/test_scenario_06_no_unearned_email_promise.test.ts` scans patient/guest acquisition surfaces for prohibited delivery claims and hardcoded response promises.

## Updated Priority Implementation Plan

### P0 — Safety/security/data-isolation issues

No new P0 code is introduced by these continuity changes. Before deployment, apply all migrations in order and repeat the existing two-clinic, consent, redaction, logging, and provider-boundary tests against hosted Supabase.

### P1 — Core trust and continuity issues

1. Apply `202609100005_continuity_reengagement.sql` and configure/test VAPID over HTTPS.
2. Exercise clinician response → outbox → Web Push → re-authentication → exact conversation with two synthetic patient accounts, including the negative cross-patient path.
3. Exercise active → expired → purged recovery with hosted cron and synthetic data.
4. Add a bounded retry/lease worker and an overdue query only if the hosted acceptance path is stable.

### P2 — Reliability/data-integrity issues

1. Add cleanup-job monitoring and notification-job operational visibility.
2. Reconcile converted clinical provenance retention with patient erasure policy.
3. Add browser E2E tests for permission denial, expired auth, obsolete recovery tokens, and unsupported Push.

### P3 — UX/completeness improvements

1. Add an authenticated patient notification-preferences page across multiple devices.
2. Consider one transactional email transport only after provider credentials, legal basis, templates, receipts, and bounce behavior can be demonstrated.
3. Do not attempt SMS/WhatsApp while the available provider account remains inactive.

## Updated Final Assessment

1. **SURVIVES: 9 scenarios** — 06, 08, 09, 10, 13, 15, 16, 17, 18.
2. **PARTIAL: 12 scenarios** — 01, 02, 03, 04, 05, 07, 11, 12, 14, 19, 20, 21.
3. **DOES NOT: 0 scenarios.** Scenario 01 moved to PARTIAL because an executable response/read/Web Push/re-authentication path now exists, while hosted delivery and retry proof remain incomplete.
4. **Highest-risk remaining continuity problems:** migration/VAPID not yet proven in hosted Supabase; no scheduled notification retry worker; no overdue alerting; and cleanup execution is not monitored.
5. **Recommended next order:** apply migration 005 → configure VAPID → hosted response/push/re-auth test → hosted active/expired/purged cleanup test → notification retry/overdue worker → remaining cross-clinic and provenance-retention verification.
6. **Not realistic before the deadline:** production-grade multi-channel delivery, guaranteed Web Push across browsers, legacy-link migration, a fully monitored retry platform, and comprehensive two-device E2E. These remain explicitly PARTIAL rather than being represented by UI promises.

## Guest Boundary Reassessment — 10 September 2026

This section supersedes the earlier implementation observations for Scenarios 04 and 12. Both remain PARTIAL until the new migration and opt-in isolation suite pass against the submitted hosted Supabase project.

## Scenario 04 — Value before identity and consent-gated staff visibility

Status: PARTIAL

### Current implementation

The guest page has no initial identity wall. `app/components/guest-chat.tsx:22-124` loads and completes a guest exchange before it can set the secure-continuation state. `src/features/guest-chat/service.ts:146-175` now derives continuation availability only from a committed `funnel_events.name = 'value_event'`; an assistant presentation flag is no longer enough. The turn writer at `src/features/guest-chat/service.ts:228-325` clears `valueType` on redaction/output failures and writes `requires_secure_continue` only when a real value type survived all safety gates. Emergency-only guidance no longer exposes a routine identity handoff.

The production conversion route calls `convert_lead_to_patient_v3` at `app/api/conversion/route.ts:43-58`. Its wrapper in `supabase/migrations/202609100006_guest_boundary_enforcement.sql` requires a committed `value_event`, preserves authenticated/idempotent conversion through v2, revokes authenticated execution of v2, and therefore prevents a forged UI flag from bypassing value-before-identity. The next unit—identity verification and explicit named-clinic sharing—is genuinely required only for persistent PatientSession continuity and staff visibility.

Before consent, staff have no LeadSession listing or guest-thread route. Direct message access is revoked in `supabase/migrations/202609030001_guest_chat.sql`; after conversion, the staff message policy at `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:556-567` requires an active same-clinic membership and latest healthcare-sharing consent. `src/features/staff/service.ts:10-110` queries only RLS-filtered sent escalations and their authorized messages.

### What breaks first

In repository logic, a failed/blocked response cannot unlock conversion, and a staff account reads zero guest rows before consent. The remaining uncertainty is deployment proof: until migration 006 and the hosted isolation test run successfully, the submitted database may still expose the older v2 conversion grant and there is no live evidence that its RLS configuration matches the repository.

### Missing

- Successful execution of migration 006 in hosted Supabase.
- A recorded hosted run of the opt-in Guest/Patient A/Patient B/Staff negative test.
- Browser E2E proof that the CTA is absent after a synthetic redaction failure and appears after a meaningful completed answer.

### Proposed fix

Apply migration 006 to the hosted test project, run the opt-in boundary suite, and capture its output for the submission. Keep the authenticated v2 grant revoked. Do not add a staff guest-search endpoint.

### Files affected

- `src/features/guest-chat/policy.ts`
- `src/features/guest-chat/service.ts`
- `app/api/conversion/route.ts`
- `supabase/migrations/202609100006_guest_boundary_enforcement.sql`
- `src/types/database.ts`
- `tests/scenarios/test_scenario_04_value_and_guest_visibility.test.ts`
- `tests/integration/test_scenarios_04_12_hosted_boundary.test.ts`

### Required test

`tests/scenarios/test_scenario_04_value_and_guest_visibility.test.ts` proves the executable value-event gate and current consent policy contract. `tests/integration/test_scenarios_04_12_hosted_boundary.test.ts`, when explicitly enabled against non-production hosted Supabase, proves Staff reads zero pre-consent rows and sees the converted-origin row only after current same-clinic consent.

## Scenario 12 — Guest PHI boundary, retention, rate limiting, and staff roles

Status: PARTIAL

### Current implementation

The actual guest-message path is `app/api/guest/messages/route.ts:44-104` → `createGuestTurn` → `append_guest_message`. `src/features/guest-chat/service.ts:177-201` resolves the opaque cookie token to one active LeadSession and invokes the database append RPC before redaction/provider work. `supabase/migrations/202609030001_guest_chat.sql:77-151` locks that token-derived session, rejects unknown/expired credentials, prevents concurrent turns, and enforces 30 guest messages per LeadSession/hour. The service stores only a non-PHI reservation first; raw content is encrypted and sealed after the safety pipeline through `seal_guest_message` in `supabase/migrations/202609100001_p0_safety_boundaries.sql:47-92`.

Guest thread reads in `src/features/guest-chat/service.ts:146-173` call the token-bound `read_guest_messages` RPC in `supabase/migrations/202609100006_guest_boundary_enforcement.sql`; the database resolves the LeadSession from the recovery-token hash and accepts no client-provided target LeadSession ID. The RPC is service-role-only and anon has no direct `messages` grant. Patient reads use `patients.auth_user_id = auth.uid()` through `messages_select_converted_origin`, and staff reads use active same-clinic current consent. This keeps pre-consent guest PHI outside the staff query path while allowing original provenance after consented conversion.

`supabase/migrations/202609100005_continuity_reengagement.sql:176-203` is the destructive retention writer: it tombstones the token hash, deletes abandoned guest messages and cascading model records, clears encrypted lead context/social/phone and recovery authority, and expires the LeadSession. `supabase/migrations/202609100006_guest_boundary_enforcement.sql:1-61` adds a PHI-free successful-run ledger and replaces the existing Supabase `pg_cron` target with `run_guest_retention_cleanup()`. Failed scheduler executions remain inspectable in `cron.job_run_details`; the application no longer treats an unused helper as execution.

### What breaks first

If migrations are applied and `pg_cron` is active, expired abandoned guest content is deleted hourly and the success count is recorded. If migration deployment, extension availability, or the cron job fails, application reads still reject the expired token but physical deletion is delayed. There is currently no external alert consuming `cron.job_run_details`, so an operator must inspect it. Converted guest evidence is deliberately retained as consented clinical provenance and is not governed by the abandoned-guest cleanup.

### Missing

- Hosted confirmation that the cron job is active and at least one expired synthetic fixture was physically deleted.
- Automated alerting when no successful run appears within the expected interval or `cron.job_run_details` reports failure.
- Distributed abuse controls beyond the current clinic/fingerprint lead limit and per-session message limit.
- A finalized retention/erasure policy for converted clinical provenance.

### Proposed fix

Apply migration 006, run the opt-in hosted suite, inspect both `guest_retention_runs` and `cron.job_run_details`, and add a simple deployment monitor if time permits. Keep Scenario 12 PARTIAL until this external scheduler evidence exists.

### Files affected

- `supabase/migrations/202609100006_guest_boundary_enforcement.sql`
- `src/types/database.ts`
- `tests/scenarios/test_scenario_12_guest_boundary_retention.test.ts`
- `tests/integration/test_scenarios_04_12_hosted_boundary.test.ts`
- `README.md`
- `TECHNICAL_BRIEF.md`

### Required test

`tests/scenarios/test_scenario_12_guest_boundary_retention.test.ts` proves that the production service invokes the database rate limiter, all reads are bound to token/identity ownership, and the scheduled target performs destructive cleanup plus observable success recording. The opt-in hosted integration test executes pre-consent staff denial, anon/incorrect-token denial, Patient A versus Patient B isolation, the 31st-message rejection, deletion/anonymisation, and retention-run persistence using synthetic fixtures.

## Updated Guest-Boundary Priority

1. Apply migration 006 to the non-production hosted project.
2. Run `tests/integration/test_scenarios_04_12_hosted_boundary.test.ts` with explicit opt-in and retain the output.
3. Verify the cron command, latest successful ledger row, and latest `cron.job_run_details` status after an hourly run.
4. Add an alert for a missing/failed cleanup run; do not claim monitored deletion until it exists.
5. Run a browser check for CTA timing after success, redaction failure, and emergency guidance.

The overall count remains **9 SURVIVES, 12 PARTIAL, 0 DOES NOT**. Scenarios 04 and 12 remain PARTIAL because repository implementation and executable hosted tests now exist, but hosted RLS and scheduler execution have not been run in this change set.

## Multi-Clinic Isolation Reassessment — 11 September 2026

This section supersedes the earlier Scenario 20 implementation notes.

### Scenario 20 — PARTIAL

#### Current implementation

- `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:114-145` centralizes staff authorization in `has_active_clinic_membership` and `has_consented_patient_access`. Both derive the caller from `auth.uid()`; the latter requires current healthcare-sharing consent for the same `clinic_id` and `patient_id`.
- The staff RLS policies at `supabase/migrations/202609030006_escalation_clinician_dashboard.sql:512-590` reuse that central predicate for patients, patient sessions, messages, risks, memories, escalations, provenance, and clinician responses. Staff mutation RPCs at lines 374-496 first load the escalation, then require the caller's active membership in that escalation's clinic and effective consent.
- Patient ownership policies at `supabase/migrations/202609030002_patient_conversion.sql:387-439` join protected rows to a patient whose `auth_user_id = auth.uid()`. Composite clinic foreign keys bind patient sessions, messages, risks, memories, and escalations to one tenant.
- `src/features/staff/auth.ts:17-45` reads memberships with the session-bound Supabase client. `src/features/staff/service.ts:11-78` reads the queue and target escalation through RLS before its sole privileged author-role lookup, which is constrained by `escalation.clinic_id`.
- `src/features/patient-sessions/service.ts:20-101` proves ownership through an RLS read before loading the origin lead and clinic with the service role. `src/features/patient-chat/service.ts:38-55` obtains an owned patient message through the authenticated `append_patient_message` RPC before privileged completion work.
- No protected patient or staff API route accepts `clinic_id`. The public acquisition `clinicSlug` selects the destination for a new lead; it does not grant protected read or mutation access.
- `tests/scenarios/test_scenario_20_multiclinic_isolation.test.ts` guards these executable/static contracts. `tests/integration/test_scenario_20_hosted_multiclinic_isolation.test.ts` creates Clinic A and Clinic B identities and records, then proves same-clinic reads, zero cross-clinic rows for patients/messages/escalations, denied cross-clinic escalation mutation, and Patient A/Patient B isolation.

#### What breaks first

With the repository migrations applied, a Clinic A clinician supplying a Clinic B resource UUID receives zero rows or an authorization error; no protected endpoint can turn a caller-supplied clinic identifier into authority. The remaining uncertainty is deployment evidence: if the hosted project is missing migrations or has manually changed grants/policies, repository inspection cannot prove its effective state.

#### Missing

- A recorded successful run of the opt-in two-clinic integration suite against the actual non-production hosted Supabase project.
- Browser/E2E confirmation and independent penetration review.
- A CI policy preventing future protected code from using request-supplied tenant identifiers as authority or performing an unscoped service-role read.

#### Proposed fix

Apply every repository migration to a non-production hosted project, run the opt-in scenario-20 suite, and retain its output with the submission evidence. Keep privileged clients server-only and preserve the rule that an authenticated RLS lookup establishes the resource and clinic before any narrowly scoped service-role follow-up.

#### Files affected

- `tests/scenarios/test_scenario_20_multiclinic_isolation.test.ts`
- `tests/integration/test_scenario_20_hosted_multiclinic_isolation.test.ts`
- `.env.example`
- `README.md`
- `TECHNICAL_BRIEF.md`
- `docs/FEEDBACK_GAP_ANALYSIS.md`

#### Required test

`test_scenario_20_multiclinic_isolation.test.ts` proves the central identity-derived authorization contract and service-role sequencing. `test_scenario_20_hosted_multiclinic_isolation.test.ts` is the negative hosted test for two clinics, two clinicians, and two patients. It is intentionally opt-in because it creates and deletes hosted Auth/database fixtures; Scenario 20 remains PARTIAL until that suite passes against the deployed project.

The overall count remains **9 SURVIVES, 12 PARTIAL, 0 DOES NOT**. Scenario 20 is materially better evidenced but is not promoted on repository contracts alone.
