# Nightingale MVP Technical Brief

Date: 3 September 2026  
Scope: 48-hour synthetic-data prototype  
Legal note: The channel matrix below is product-risk analysis, not legal advice. A Malaysian healthcare operator should obtain counsel and MAB/platform approval before a live campaign.

## Architecture and safety boundary

Nightingale is a modular monolith: one Next.js App Router application, one hosted Supabase project, and stateless OpenAI Responses API calls. The browser handles presentation and Supabase Auth cookies; Next.js Route Handlers and server-only domain services own validation, authorization, decryption, redaction, risk policy, and minimal DTO construction. PostgreSQL is the durable source of truth. OpenAI is never the conversation database.

```text
Acquisition link / simulated channel
              |
              v
 Browser: guest -> auth/consent -> patient -> staff UI
              | HTTPS; protected responses are no-store
              v
 Next.js server
  |- validation, rate limits, idempotency
  |- raw deterministic multilingual emergency floor
  |- local PHI redaction and leak assertion (fail closed)
  |- redacted model proposal -> max(rule, model) -> output safety gate
  |- Living Memory and escalation payload builders
  `- authenticated, clinic-scoped data services
              |                         |
              v                         v
 Supabase Auth + PostgreSQL        OpenAI Responses API
 RLS, grants, transactions,       redacted minimum context,
 encrypted records, provenance    store=false, structured output
```

Four entry contracts are simulated: `staff_referral`, `social_comment`, `instagram_ad_click`, and `website_widget`. No real platform account is contacted. An opaque high-entropy recovery credential is stored in an HttpOnly cookie; only its hash is stored. Guest content is encrypted and unavailable to staff. Authentication is delayed until value is demonstrated, and clinic sharing remains a separate explicit consent action.

Patient messages pass through independent safety controls in a fixed order. Shared English, Malay, and Chinese deterministic rules assess untouched text first; the LLM, redaction, parsing failure, timeout, and outage cannot lower that floor. A non-PHI placeholder reserves idempotency, then locally redacted text may be sent for a structured model proposal under an explicit abort deadline. The effective result is `max(deterministicRisk, modelRisk)`. The server releases generated content only when it is Low-risk, confident, non-diagnostic, grounded in a valid curated citation, and accepted by a deterministic output gate. Medium, High, uncertainty, timeout, invalid schema, unsafe wording, or unresolved citations produce local non-advisory copy and an escalation requirement. Provider failure is labelled as safety-only degraded mode. Only after these gates does the server seal the encrypted raw record and complete the turn. Raw text is never accepted by operational logging.

RBAC is defense in depth. Supabase Auth supplies `auth.uid()`. RLS enforces patient ownership and active same-clinic staff membership plus current healthcare-sharing consent. Direct table mutations are revoked; narrow database functions validate identity, role, clinic, consent, record state, and provenance. Next.js repeats resource checks before returning minimal views. Staff can acknowledge; only Nurse and Clinician memberships can author a protected clinical response or close a responded escalation.

## Data schema and clinician-message extension

```text
Clinic --< LeadSession --< Message (guest)
  |           |  attribution + FunnelEvent/ValueEvent
  |           `-- converts atomically after auth + consent --.
  |                                                        |
  |--< Patient --< PatientSession --< Message (patient/AI) <-'
  |       |                              |       |
  |       |                              |       `--< Citation >-- KnowledgeSource
  |       |                              `-- RiskAssessment -- Escalation
  |       `--< MemoryItem --< MemoryRevision                 |  |
  |                         provenance -> source Message -----'  `--< ClinicianResponse
  `--< ClinicMembership >-- Supabase auth.users
```

`LeadSession` owns immutable channel, campaign, creative, identity level, landing timestamp, and safe landing context. Guest messages remain attached to it after conversion rather than being copied. The atomic conversion function creates or resolves an immutable clinic-scoped `Patient`, appends contact and consent evidence, creates a `PatientSession` linked through `origin_lead_session_id`, and revokes guest recovery authority. The patient view reads both the origin guest thread and new patient turns, preserving provenance without asking the concern again.

Every patient message has at most one `RiskAssessment`, including level, redacted rationale, confidence, rule matches, pipeline version, model provenance, and whether escalation is required. A releasable assistant message can have ordered `Citation` rows pointing to reviewed `KnowledgeSource` spans and integrity hashes.

The visible Patient Profile is a projection of `MemoryItem.current_revision_id`. Each `MemoryRevision` is append-only and links to its source message, prior revision, extraction model run, confidence, status, and effective time. “I take Advil” followed by “I stopped last week” therefore changes the current projection while retaining both states and sources.

An escalation begins as `required`. The patient’s Send to Clinic action atomically freezes an encrypted triage summary, encrypted point-in-time profile snapshot, acquisition snapshot, trigger message, response window, and normalized provenance pointers, then changes status to `queued`. The clinician dashboard can acknowledge, respond, and close it without exposing unconsented or cross-clinic records.

A later clinician messaging module attaches without changing these identities: add a `care_threads` row keyed by `patient_id`, `clinic_id`, and optionally `escalation_id`; add `care_thread_id` to new staff/patient `messages`; and reuse `ClinicMembership` for authorship. Delivery receipts and notification attempts should be separate metadata records. Clinical replies remain encrypted application records, while audit logs keep only IDs/hashes/statuses. Existing `ClinicianResponse` rows can either remain immutable escalation notes or be migrated as initial thread messages with their original membership and timestamp provenance.

## Channel considerations

Legend: G = acceptable with the stated safeguards; Y = conditional and needs redesign/approval; R = do not implement. “Legal” considers Malaysia’s PDPA and MAB healthcare-advertising rules; “Policy” considers the named platform. The overall choice follows the most restrictive axis.

| Channel / exact contract | Technical | Legal | Policy | Trust | Overall / implementation decision |
|---|:---:|:---:|:---:|:---:|---|
| Clinic website widget, user initiated | G | G | G | G | **G — simulated and implemented.** No staff visibility before consent. |
| Staff gives patient a private topic link during care | G | G | G | G | **G — simulated entry implemented.** Production authoring UI deferred. Token must not contain the topic. |
| QR on an after-visit sheet or clinic counter | G | G | G | G | **G — proposed.** First-party context and explicit patient action. |
| Patient-requested appointment/recovery link | G | G | G | G | **G — proposed.** Transactional, minimal, expiring, and not reused for marketing. |
| Instagram click-through ad using approved, factual, non-condition-assumptive copy | G | G* | G* | G | **G — simulated and implemented.** `*` Requires MAB approval where applicable and current Meta review. |
| Google contextual/search ad, not health-profile retargeting | G | G* | G* | G | **G — schema-ready, not exposed in the demo UI.** Use approved factual copy and contextual intent only. |
| Organic Google Business/Profile or own-review-page click | G | G | G | G | **G — schema-ready.** Do not scrape reviewers or infer health needs. |
| Public social comment -> private reply | Y | Y | Y | Y | **Y live; G only as a no-contact simulation.** Improve with user-requested keyword, neutral reply, official API, rate limits, and consent before health detail. |
| Platform lead form collecting contact only | G | Y | Y | Y | **Y — not implemented.** Add just-in-time notice, no health questions, explicit follow-up purpose, and platform/MAB review. |
| Community webinar/newsletter opt-in | G | Y | G | G | **Y — not implemented.** Separate marketing consent and avoid condition inference. |
| Competitor-review scraping and outreach | G | R | R | R | **R — rejected.** Public availability is not permission to repurpose reviewer identity/health context or bypass platform controls. |
| Unsolicited DMs to users in health threads/groups | Y | R | R | R | **R — rejected.** Sensitive-context inference plus unexpected private contact is incompatible with consent and trust. |
| Condition-based retargeting from chat/profile/message data | G | R | R | R | **R — rejected.** Never export health-derived audiences, pixels, or conversion payloads. |

The legal baseline is deliberately conservative. Malaysia’s regulator defines health information as sensitive personal data and describes express consent and withdrawal rights ([PDPA FAQ](https://www.pdp.gov.my/ppdpv1/en/faq/)); Act 709 also provides limited medical/vital-interest exceptions, not a blanket marketing permission ([Act 709](https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf)). MAB’s 2023 guideline says healthcare-facility advertising generally requires approval and must be factual, substantiable, and non-misleading ([MAB guideline](https://www.pharmacy.gov.my/v2/sites/default/files/document-upload/advertising-guidelines-healthcare-facilities-and-services-mab-3.2023.pdf)). Google classifies health as a sensitive interest and prohibits advertiser-curated audience targeting for it ([Google health targeting policy](https://support.google.com/adspolicy/answer/16701855?hl=en)); its broader healthcare policy also requires local-law compliance and restricts some categories ([Google healthcare policy](https://support.google.com/adspolicy/answer/176031)). Meta’s own materials prohibit discriminatory use of medical conditions and emphasize user control over who can message them ([Meta advertising update](https://about.fb.com/news/2017/02/improving-enforcement-and-promoting-diversity-updates-to-ads-policies-and-tools/), [Meta private messaging](https://about.fb.com/news/2021/12/metas-approach-to-safer-private-messaging/)). Policies change, so a production launch needs a dated review of the precise creative, audience, destination, and messaging flow.

## First-principles assumptions

- A useful answer should be earned before identity is requested; authentication is a security boundary, not the value proposition.
- A public interaction is not consent to infer a condition, send a private health message, or market later.
- Clinical content and operational telemetry are different data classes. The former may be encrypted for care/provenance; the latter must remain PHI-free.
- Attribution survives conversion, but authority does not: a guest recovery token is revoked when the authenticated patient session is created.
- Uncertainty should move toward a human, never toward reassurance. The patient—not the model—confirms the routine clinic handoff; emergency copy always says not to wait.
- Email/phone can change and are contact points, not patient primary keys.
- Same-clinic consent is checked at read time, not assumed forever from historical conversion.
- “Encrypted and redacted” is not equivalent to “compliant.” This build uses synthetic data and needs legal, clinical-safety, security, retention, residency, and vendor-contract review before real PHI.

## Trade-offs and scope cuts

The build optimizes one complete, inspectable safety/provenance path. It uses a modular monolith and request/response refresh instead of microservices, queues, realtime subscriptions, or background notification workers. It implements a clinician escalation queue but cuts warm-lead ranking, funnel visualization, staff-created referral links, outbound email/SMS, consent withdrawal UI, contact changes, multi-clinic patients, attachments, full observability, and real social/ad integrations. Channel enums exist beyond the four demo entries, but that is schema readiness—not an implementation claim.

Testing prioritizes deterministic logic and database contract assertions within the timebox. Hosted RLS integration tests, browser E2E, load testing, accessibility audit, clinical validation, and adversarial redaction evaluation remain required production work. Curated database citations are used instead of live web retrieval so the release gate is deterministic and inspectable.

## Voice AI strategy

Audio should be another capture modality, not a parallel clinical model. A future `audio_artifacts` table would hold an immutable ID, `clinic_id`, owner/session, object-storage key, media type, duration, checksum, recording/transcription consent event, retention deadline, and timestamps. Storage buckets would use the same patient/staff RLS boundary; signed URLs would be short-lived. A `transcription_runs` record would capture provider/model/language/status/error and point to an encrypted transcript `Message` or transcript revision.

The transcript then enters the existing pipeline unchanged: local identifier redaction, leak assertion, deterministic risk gate, structured assessment, Living Memory proposals, citations, and escalation provenance. Message fields can reference `audio_artifact_id` and transcription provenance so clinicians can distinguish spoken source, transcript, and later correction. Streaming partial transcripts must never mutate the profile or trigger a routine handoff until finalized; obvious emergency phrases may trigger immediate deterministic safety copy. Raw audio should have a shorter explicit retention period than the derived clinical record, separate consent, no analytics reuse, and no voice-biometric inference. The MVP deliberately implements none of this until text safety, consent, and access-control integration are proven.
