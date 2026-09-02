# Nightingale 48-Hour Build Requirements

Source: `2026 48 Hour Build_ Nightingale Candidate Brief.pdf` (6 pages)

This document extracts and organizes the official candidate-brief requirements. It does not resolve contradictions or add product assumptions. Page references refer to the source PDF.

## Classification

- **Mandatory:** Explicitly marked `must`, `mandatory`, or `required`, or presented as baseline behavior in the Product Requirements and Technical Constraints.
- **Optional:** Explicitly described as optional, permitted, or not required.
- **Bonus:** Explicitly described as bonus.
- **Ambiguous:** Unclear, internally conflicting, or phrased as an exploratory question. These items require a decision before implementation.

## 1. Functional requirements

### 1.1 Acquisition and attribution — Mandatory

- Simulate acquisition into the Nightingale portal. Real platform integration is bonus. (pp. 1–2)
- Implement these channel contracts:
  - `staff_referral` — mandatory.
  - `social_comment` — mandatory.
  - At least two of the remaining listed channel contracts. (pp. 1–2)
- `staff_referral` must allow a clinician, nurse, or staff member to enter a topic and generate a personal link. Opening the link must preload that context and identify the `LeadSession` as a staff referral. (p. 1)
- `social_comment` must represent Instagram, TikTok, and Facebook comments, preserve the platform, and treat a known social handle as a lower identity level than a known email or phone. (p. 1)
- Remaining listed acquisition contracts are:
  - `instagram_ad_click` / `google_ad_click`: anonymous, with campaign context.
  - `lead_form`: identified, with a volunteered email.
  - `google_reviews`: an anonymous prospect follows an "ask us" link from the clinic's public reply.
  - `website_widget`: anonymous, with page/topic context. (p. 2)
- Every arrival must create a `LeadSession`. (p. 2)
- Every `LeadSession` must retain:
  - `clinic_id`
  - `source_channel`
  - `campaign_id`
  - `creative`
  - `identity_level`
  - `landing_timestamp` (p. 2)
- Attribution must survive conversion to the final `PatientSession` and must be included in the escalation payload. (p. 2)

### 1.2 Guest value and scope boundary — Mandatory

- A guest must receive useful value before being required to create an account. (p. 2)
- Guest responses may cover services, hours, availability, and general education. They must remain non-diagnostic. (p. 2)
- The system must define and log explicit `value_event` types. A value event is a turn where the system delivers substantive help, such as answering a service question, producing a summary, or preparing questions. (pp. 2–3)
- Generated guest value must be contextual rather than generic. The brief gives a 240-character concern-sharing message as an example. (p. 2)
- Any numeric statistic shown to a prospect must resolve to a live query over the system's own data. (p. 2)
- When the count is zero or trivial, show nothing or a truthful alternative; never display a fabricated number. (p. 2)
- Enforce PHI redaction before patient-specific clinical intake is sent to an LLM. (p. 2)
- If a guest volunteers sensitive information:
  - Encrypt it.
  - Hide it from staff until consent. (p. 2)
- Destroy guest data after a selected number of days. (p. 2)
- Justify retention of any PHI-free guest metadata used for abandonment analytics. (p. 2)
- Rate-limit guest sessions against abuse. (p. 2)

### 1.3 Channel rules — Mandatory

- Store opening rules in one declarative configuration file or table, not in scattered conditional statements. (p. 2)
- Map `channel × identity_level × time_of_day` to an opening strategy. (p. 2)
- The same incoming message from two channels must receive channel-appropriate openings. (p. 2)
- Never ask an identified lead for information already provided. (p. 2)

### 1.4 Conversion, identity, and consent — Mandatory

- Authentication must trigger after value is delivered or when clinical intent arises, not immediately on landing. (p. 2)
- Present a clear trust transition, such as "Continue securely to send this to the clinic." (p. 2)
- On continuation:
  - Authenticate the user.
  - Obtain consent to share healthcare information with the named clinic.
  - Migrate permitted guest context into a `PatientSession`.
  - Preserve provenance to original guest messages and acquisition source.
  - Do not require the patient to repeat information already supplied. (p. 2)
- At signup, collect:
  - Verified email as the login identifier.
  - Phone as a contact point. (p. 2)
- Use an immutable internal patient ID. Email and phone must be changeable without breaking history. (p. 2)
- Before signup, offer a personalized, session-derived resource in exchange for an email. It must not be a generic PDF. (p. 2)
- Treat the initial earned-email send as transactional. (p. 2)
- Require separate, timestamped marketing consent for any further marketing communication. (p. 2)
- Redact PHI from email. (p. 2)
- Support recovery of an abandoned guest session through a link, with context intact during the selected retention period. (p. 3)

### 1.5 Funnel events and warm leads — Mandatory

- Emit the following structured funnel events in order as applicable:

  `visitor → conversation_started → value_event → auth_started → consented → patient_created → escalation_sent` (p. 3)

- Display simple conversion metrics per channel. (p. 3)
- Rank warm leads using a simple, transparent score based on:
  - Recency
  - Channel
  - Identity level
  - Funnel stage (p. 3)
- Show each lead's top concern. (p. 3)
- Make contact suggestions only when contact information and consent exist. (p. 3)
- High-risk clinical content must route to escalation, never to a sales touch. A high clinical score is a compassion priority, not a sales priority. (p. 3)

### 1.6 Patient intake chat and risk gating — Mandatory

- Provide a one-to-one messenger-style thread with "Nightingale AI." (p. 3)
- The AI must be empathetic and strictly non-diagnostic. (p. 3)
- The AI must not:
  - Diagnose a condition.
  - Recommend medication changes.
  - Provide treatment plans beyond general information and advice to consult a clinician.
  - Give false reassurance for high-risk symptoms. (p. 3)
- Before responding to every patient message, calculate and persist:
  - `risk_level`: Low, Medium, or High.
  - `risk_reason`: short explanation.
  - Response `confidence`: low, med, or high.
  - Timestamped `risk_provenance`. (p. 3)
- For Low risk, provide education/support with citations. (p. 3)
- For Medium or High risk, stop advice and begin the Send-to-Clinic path. (p. 3)
- The system must never miss these High-risk phrases:
  - "crushing chest pain"
  - "difficulty breathing"
  - "heavy bleeding"
  - "want to hurt myself" (p. 3)
- Ambiguous symptoms such as "my chest feels funny" must escalate or receive an honest expression of uncertainty. (p. 3)
- Clearly display below the messenger text box: "If this is an emergency, exit Nightingale and dial 999 for Emergency Services." (p. 3)

### 1.7 Living Memory — Mandatory

- Maintain a live-updating Patient Profile. (p. 3)
- Extract at least:
  - Chief complaint.
  - Key symptoms, including timeline when present.
  - Current medications.
  - Allergies when present. (p. 3)
- When a patient corrects a fact, update the profile while retaining an unbroken provenance chain. (p. 3)
- Each memory item must contain:
  - `value`
  - `status`
  - `provenance_pointer` linking to the source message
  - `updated_at` (p. 3)
- Guest facts that survive conversion must retain provenance to the original `GuestMessage`. (p. 3)

### 1.8 Send to Clinic — Mandatory

- Show one clear "Send to Nurse/Clinic" action when:
  - Risk is High.
  - Risk is Medium or ambiguous.
  - The patient sounds unsure.
  - The patient wants more clarity.
  - The patient requests a diagnosis. (p. 4)
- Persist an escalation payload containing:
  - Triggering message.
  - Triage summary of one to five bullets.
  - Profile snapshot.
  - Provenance pointers.
  - Acquisition context from Section 1. (p. 4)
- Show a confirmation and a response expectation of 12–18 hours. (p. 4)
- Allow the patient and AI to continue chatting after escalation is sent. (p. 4)
- Store enough structured information for a clinician to begin review without requiring the patient to repeat the story. (p. 4)
- Include an escalation status and room for a `ClinicianResponse`. (p. 4)

### 1.9 Staff and trust behavior — Mandatory

- Staff, clinicians, and nurses must be able to authenticate, view warm leads, and perform staff actions such as creating referral links. (p. 4)
- If a guest asks, "Are you a real doctor?", answer precisely and honestly:
  - What the AI is.
  - What the clinic is.
  - When a human becomes involved. (p. 5)

## 2. Non-functional requirements — Mandatory

- Build a mobile-responsive PWA. (p. 4)
- Make the patient experience intuitive like a mainstream messenger. (p. 1)
- Produce a production-credible vertical slice that could plausibly be deployed in a clinic. (p. 1)
- Catch acquisition inquiries "in milliseconds"; the PDF supplies no measurable latency threshold. (p. 1)
- Enforce RBAC server-side and reject unauthorized requests server-side. (p. 4)
- Use TLS in transit and encryption at rest. (p. 4)
- Use synthetic data only. (p. 4)
- Redact required identifiers before sending text to the LLM. (p. 4)
- Make handoffs explainable, including when and how a `LeadSession` becomes a `PatientSession`. (p. 4)
- Audit logs must be PHI-free and contain IDs, hashes, or metadata only. (p. 4)
- Do not place raw message content in database logs. (p. 4)
- Use structured JSON logs for all events. (p. 4)
- Document behavior when:
  - The LLM times out.
  - Redaction fails.
  - Authentication is unavailable. (p. 4)
- Include schema fields for future audio transcript/recording IDs. (p. 4)
- Prefer minimal moving parts and a clear, simple schema. (p. 6)
- Maintain a clear commit history and explicitly document constraints and trade-offs. (pp. 5–6)

Qualities such as "delightful," "trustworthy," "empathetic," "easy," and "production-credible" are required goals, but the PDF does not provide objective acceptance thresholds.

## 3. Optional requirements

- Implementing the actual email/phone change workflow is optional. Schema support for changes remains mandatory. (p. 2)
- Social handles may be stored. (p. 2)
- Audio recording does not need to be implemented. Schema readiness remains mandatory. (p. 4)
- Technology stack and LLM provider are the candidate's choice; Python/Node are suggestions. (p. 4)
- Recommended demo scenarios are suggestions; the demo video itself is mandatory. (pp. 5–6)

## 4. Bonus requirements

- Real WhatsApp, Meta, TikTok, or Instagram integration. (pp. 1, 6)
- A real `social_comment` private-reply/DM that delivers a value event. (p. 6)
- A personalized, research-grounded, unbranded Family Communication Kit suitable for forwarding. (p. 6)
- Intent-based channel rules. (pp. 2, 6)
- A full dashboard beyond simple per-channel conversion metrics. (p. 3)
- Composite engagement weighting and decay curves. (pp. 3, 6)
- Memory contradiction/conflict flagging. (pp. 3, 6)
- Dormant-lead lifecycle: active → cooling → dormant → one consented recall → suppressed, with risk awareness. (p. 6)
- Synthetic-traffic replay. (p. 6)
- Integration with current Voice schema thinking or clinical-summary generation. (p. 6)
- Convincingly invalidate one of the brief's assumptions with a better consideration. (p. 6)
- Bonus automated tests for:
  - Channel-rule differentiation.
  - Session recovery.
  - Staff-referral context prefill.
  - Warm-lead scoring.
  - Citation grounding to real source spans.
  - Re-engagement consent. (p. 5)

## 5. Required user flows

1. **Channel arrival:** Channel/link/comment → create `LeadSession` → retain attribution and identity level → select a declarative channel-specific opening.
2. **Guest value:** Guest asks a question → receive useful non-diagnostic help → record a `value_event` → show only truthful live-query statistics → invite secure continuation after value or clinical intent.
3. **Guest sensitive-data handling:** Guest volunteers sensitive data → redact it before applicable LLM use → encrypt stored data → hide it from staff before consent → apply retention and rate limits.
4. **Guest-to-patient conversion:** Trust transition → authentication → verified email and phone collection → named-clinic consent → create/link patient → migrate permitted context → preserve provenance and attribution → do not repeat the concern.
5. **Earned email:** Offer a personalized, session-derived resource → collect email → send a PHI-redacted transactional email → require separate timestamped consent for later marketing.
6. **Session recovery:** Guest returns using a recovery link during the configured retention period → restore prior context.
7. **Staff referral:** Authorized staff enters a topic → system generates a personal link → recipient opens it → create a `staff_referral` LeadSession with preloaded context.
8. **Social comment:** Comment preserves platform and handle-level identity → simulated or real private-reply path supplies a portal link → portal retains source context.
9. **Low-risk intake:** Authenticated patient sends a message → redact before LLM → calculate risk before response → provide cited, non-diagnostic education → update the structured profile.
10. **Memory correction:** Patient states a fact → create active memory item → patient corrects it → retain prior and current provenance-linked states → update the visible profile.
11. **Risk escalation:** Patient submits High, Medium, or ambiguous content or asks for diagnostic clarity → stop advice → offer/trigger Send to Clinic → persist payload → confirm submission and response expectation.
12. **Post-escalation continuity:** Patient and AI continue chatting while the escalation remains persisted and reviewable.
13. **Clinician review:** Authorized clinic user opens the consented patient's structured escalation, profile, and provenance → begins review without requiring repetition → can use the response/status structure.
14. **Warm-lead review:** Authorized clinic user views ranked leads and top concern → receives contact suggestions only with contact data and consent → clinical risk overrides sales priority.
15. **Funnel analytics:** Record the required event sequence → calculate simple per-channel conversion metrics.

## 6. Required logical data model

The PDF requires the following logical records or storage capabilities but does not prescribe a physical schema.

| Entity | Required purpose or fields |
|---|---|
| `Clinic` | Clinic identity/name; scopes acquisition, consent, sessions, staff access, and escalation. |
| `User` / `AuthIdentity` | Authentication identity and role. |
| `StaffMembership` | Associates users with Staff, Clinician, or Nurse roles and clinic access. Exact tenant rules are ambiguous. |
| `Patient` | Immutable internal primary key. |
| `ContactPoint` or equivalent | Verified email, phone, and optionally social handles; mutable without breaking history. |
| `LeadSession` | Guest session, attribution, identity level, recovery/expiry state, and guest context. |
| `GuestMessage` | Original guest messages needed for provenance after conversion. |
| `PatientSession` | Authenticated clinical-intake session receiving permitted converted context. |
| `Message` | Chat turn, sender, timestamp, and provenance target. |
| `Attribution` or embedded fields | `clinic_id`, channel, campaign, creative, identity level, and landing timestamp. |
| `Consent` | Healthcare-sharing consent associated with a named clinic; separate timestamped marketing consent. |
| `ChannelRule` | Channel × identity level × time-of-day opening strategy. |
| `FunnelEvent` | Event name, session/patient reference, channel context, and timestamp. |
| `ValueEvent` | Type of substantive help, source session, generated content/accuracy metadata, and timestamp. |
| `MemoryItem` | Fact type, `value`, `status`, `provenance_pointer`, `updated_at`, and sufficient mutation history. |
| `Citation` | Citation associated with a low-risk educational response. |
| `RiskAssessment` | Per-message risk level, reason, confidence, and timestamped provenance. |
| `Escalation` | Trigger message, triage summary, profile snapshot, provenance, attribution context, status, and response expectation. |
| `ClinicianResponse` | Response structure linked to an escalation. |
| `AuditLog` | Structured PHI-free JSON event metadata without raw message content. |
| Voice fields/record | Future transcript and recording identifiers; exact placement is not specified. |

Required relationship chain:

```text
Clinic
├── StaffMembership ── User/AuthIdentity
├── LeadSession ── GuestMessage
│   ├── Attribution
│   ├── FunnelEvent / ValueEvent
│   └── converts after auth + consent to PatientSession
└── Patient ── PatientSession ── Message
                         ├── RiskAssessment
                         ├── Citation
                         ├── MemoryItem ── provenance → Message or GuestMessage
                         └── Escalation
                              ├── profile snapshot
                              ├── provenance → source messages/facts
                              ├── acquisition context → LeadSession/Attribution
                              └── ClinicianResponse
```

Persistence constraints:

- Conversion must not sever the `LeadSession` or `GuestMessage` provenance chain.
- Email and phone must not be immutable patient identifiers.
- Memory mutation must preserve provenance for prior and current fact states.
- An escalation must retain a point-in-time profile snapshot.
- Clinic-sharing consent and marketing consent must be separate.
- Future voice transcript/recording identifiers must fit the schema.

## 7. Security, privacy, RBAC, and PHI redaction

### 7.1 Authentication and authorization — Mandatory

- Enforce authorization server-side using RLS, middleware, backend checks, or a demonstrated equivalent. (p. 4)
- Reject unauthorized access server-side. (p. 4)
- Patient A must not access Patient B's chat or patient data. (pp. 4–5)
- A patient must not access the clinician triage queue. (p. 5)
- Clinician, staff, and nurse access may view consented patients. (p. 5)
- Staff roles may access warm leads and staff-referral actions. (p. 4)
- Demonstrate how access control is enforced. (p. 4)

### 7.2 Consent and communication privacy — Mandatory

- Obtain consent to share healthcare information with the named clinic. (p. 2)
- Do not expose volunteered guest sensitive information to staff before consent. (p. 2)
- Suggest warm-lead contact only when contact data and consent exist. (p. 3)
- Treat the first earned-email send as transactional. (p. 2)
- Require separate, timestamped marketing consent for further marketing. (p. 2)

### 7.3 PHI handling — Mandatory

- Use synthetic data only. (p. 4)
- Redact names, IC/ID numbers, and phone numbers before sending text to the LLM. (p. 4)
- Redact PHI before patient-specific clinical intake reaches the LLM. (p. 2)
- Remove PHI from email. (p. 2)
- Encrypt sensitive guest data and hide it from staff before consent. (p. 2)
- Encrypt data at rest and use TLS in transit. (p. 4)
- Destroy guest data after a selected retention period. (p. 2)
- Retained guest analytics metadata must be PHI-free and justified. (p. 2)

### 7.4 Logs and provenance — Mandatory

- Audit logs must be PHI-free. (p. 4)
- Audit logs may contain IDs, hashes, and metadata only. (p. 4)
- Raw message content must not be stored in database logs. (p. 4)
- All event logs must be structured JSON. (p. 4)
- Clinical records needed for provenance must be kept separate from PHI-free operational/audit logs.

### 7.5 Required failure-mode documentation

- LLM timeout behavior.
- Redaction failure behavior.
- Authentication outage behavior. (p. 4)

The PDF does not explicitly state that redaction failure must fail closed; this must be clarified rather than assumed.

## 8. Required automated tests

Automated tests and instructions for running them are required. (pp. 4–5)

### 8.1 `Test_guest_to_patient_conversion.py`

- Guest arrives with `source=instagram&campaign=ivf_over40`.
- Guest states a concern.
- After authentication and consent:
  - Context appears in `PatientSession`.
  - Provenance resolves to the original `GuestMessage`.
  - Attribution is retained.
  - The concern is never re-asked.

### 8.2 `test_value_events.py`

- Every displayed statistic traces to a live query.
- Generated value messages are tracked.
- Generated value messages are validated for accuracy.

### 8.3 `test_escalation_payloa.py`

- Send to Clinic persists:
  - Triggering message.
  - Triage summary.
  - Profile snapshot.
  - Provenance.
  - Acquisition context.

The filename appears truncated in the source PDF; `test_escalation_payload.py` is a likely correction but is not explicitly specified.

### 8.4 `test_risk_escalation.py`

- Input: "I have crushing chest pain."
- Assert `risk_level == high`.
- Assert the AI does not provide advice.
- Assert `escalation_required == true`.

### 8.5 `test_memory_mutation.py`

- "I take Advil" produces an active Advil medication fact.
- "Actually I stopped last week" removes it or marks it stopped.
- Provenance links exist for both states.

### 8.6 `test_redaction.py`

- Input contains the name "John Doe" and IC `S1234567A`.
- LLM input contains `[REDACTED]` for both fields.
- Logs contain neither raw value.

### 8.7 `test_access_control.py`

- Patient A cannot fetch Patient B's chat history.
- A patient cannot fetch the clinician triage queue.
- Clinician, Staff, and Nurse access can see consented patients.

### 8.8 `test_trust`

- When a guest asks "Are you a real doctor?", return a precise, honest answer explaining the AI, the clinic, and when a human becomes involved.

The source uses inconsistent test-name casing/extensions and does not supply required tests for every mandatory behavior. Additional coverage should include all four emergency phrases, ambiguous and Medium-risk handling, phone redaction, consent gating, and documented failure modes.

## 9. Required deliverables

### 9.1 Git repository

- Working application.
- Tests.
- Clear commit history. (p. 5)

### 9.2 README

- Setup and run instructions.
- Instructions for running tests.
- Location of the redaction pipeline.
- Explanation of RBAC enforcement. (p. 5)

### 9.3 Technical Brief — Two to three pages

- Architecture diagram or explanation.
- Data schema explaining how Messages, Profile, Citations, and Escalations are linked.
- Explanation of how a future clinician messaging module can attach.
- Channel considerations:
  - Classify every considered channel and less-obvious new channels.
  - Discuss competitor-review scraping, health-thread DMs, and condition-based retargeting.
  - Rate each green/yellow/red on:
    - Technical possibility.
    - Legality under PDPA and Malaysian MAB healthcare-advertising rules.
    - Platform policy.
    - Trust compatibility.
  - Implement only green channels.
  - Explain how yellow channels could be improved.
- Assumptions or first-principles thinking.
- Trade-offs and scope cuts.
- Voice AI strategy explaining how audio would fit the schema. (p. 5)

### 9.4 Attribution

- `ATTRIBUTION.txt` listing all external libraries, models, and licenses. (p. 5)

### 9.5 Demo video

- Maximum duration: three minutes. (p. 5)
- Recommended scenarios include:
  - Instagram-to-patient conversion and live profile update.
  - High-risk gate, Send to Clinic, and persisted escalation.
  - Staff-referral warm handoff with preloaded topic.
  - Per-channel funnel metrics, warm leads, abandonment, and delayed authentication. (pp. 5–6)

### 9.6 Submission

- Due: Thursday, September 3, 2026, 1:00 PM SGT/MYT.
- Submit the repository link or ZIP, brief, and deliverables to `irakumar@ntngale.com`.
- CC `yunxint@sunway.edu.my`.
- Subject: `Nightingale 48HR Build — <Your Name>`. (p. 6)

## 10. Prioritized 48-hour implementation plan

This plan prioritizes safety, security, end-to-end provenance, and the highest-scoring core vertical slice before bonus work.

| Time | Priority and output |
|---|---|
| Hours 0–4 | Resolve blocking ambiguities. Select channel contracts and define retention, redaction, roles, consent, acceptance criteria, architecture, and schema. |
| Hours 4–9 | Establish application, database, authentication, clinic scoping, RBAC, immutable patient identity, consent records, structured PHI-free logging, and test harness. |
| Hours 9–14 | Implement `LeadSession`, `GuestMessage`, attribution, declarative channel rules, `staff_referral`, `social_comment`, two selected channel contracts, rate limiting, and recovery/expiry fields. |
| Hours 14–19 | Implement guest value, a truthful live-query metric, explicit `value_event`, trust disclosure, earned-email boundary, and delayed authentication invitation. |
| Hours 19–24 | Implement authentication, named-clinic consent, and guest-to-patient conversion with unbroken attribution/message provenance and no repeated concern. Complete the conversion test. |
| Hours 24–30 | Implement patient messenger, pre-LLM redaction, per-message risk records, mandatory emergency phrases, non-diagnostic response constraints, citations, and emergency notice. |
| Hours 30–35 | Implement live Patient Profile, minimum fact extraction, correction/mutation history, and provenance pointers. Complete memory and redaction tests. |
| Hours 35–39 | Implement Send to Clinic, persisted escalation payload, confirmation, status, clinician-response slot, and post-escalation continuity. Complete escalation and risk tests. |
| Hours 39–42 | Implement server-enforced patient isolation, staff views, warm-lead ranking, clinical-risk safety override, and simple channel metrics. Complete RBAC tests. |
| Hours 42–45 | Run all required tests and add focused coverage for emergency phrases, ambiguity, phone redaction, channel rules, consent gating, and redaction failure. Fix core-path failures. |
| Hours 45–48 | Complete failure-mode documentation, architecture/schema brief, channel analysis, trade-offs, README, attribution, synthetic demo data, and the sub-three-minute demo. |

Do not begin bonus integration until conversion, risk, memory, escalation, redaction, and RBAC tests pass.

## 11. Ambiguities requiring resolution

| Issue | Ambiguity |
|---|---|
| Guest access versus PWA authentication | The journey requires unauthenticated `LeadSession` access, but p. 4 says users must authenticate before accessing the PWA. It is unclear whether that statement applies only to protected patient/staff areas. |
| Patient access wording | "Guest or Patient cannot access patient data" literally prevents patients from accessing their own data, while the tests prohibit only Patient A from accessing Patient B. |
| "No PHI Redaction Pipeline" | The phrase is immediately followed by a requirement to redact identifiers and appears to contain a wording or punctuation error. |
| PHI definition | Names, IC/ID numbers, and phone numbers are explicit, but "robust PHI redaction" suggests a broader undefined scope. |
| Channel count | The brief says two of the "other four" contracts, but the list can be counted as four bullets or five contracts if Instagram and Google ad clicks are separate. |
| Social-comment baseline | `social_comment` is mandatory while real integration is bonus. The exact simulated webhook/private-reply behavior is not defined. |
| Likes | Whether likes should trigger contact is presented as an exploratory question and raises policy and consent issues. |
| Value-event examples | It is unclear whether both the 240-character message and live statistic must be implemented or are examples of acceptable value events. |
| Trivial count | The threshold for a "trivial" count and the definition of a unique person/question are unspecified. |
| Guest retention | `X` days is left to the candidate, with no minimum or maximum. |
| Converted guest deletion | It is unclear whether converted `GuestMessage` records are exempt from deletion because permanent provenance is required. |
| Permitted context | The PDF does not define which guest fields may migrate after consent or what happens to excluded data. |
| Consent model | Versioning, withdrawal, expiry, guardian/minor flows, and per-clinic renewal are unspecified. |
| Identity verification | The email verification mechanism is unspecified; phone collection is required but phone verification is unclear. |
| Interrupted signup | "Can an interrupted signup complete correctly?" is phrased as a question rather than a clear acceptance criterion. |
| Recovery-link security | Token format, expiration, revocation, device binding, and sensitive-data visibility are unspecified. |
| Risk implementation | The PDF does not specify deterministic, model-based, or hybrid classification. |
| Ambiguous symptoms | Section 6 permits escalation or honest uncertainty, while Section 8 appears to require Send to Clinic for Medium/Ambiguous content. |
| Escalation initiation | "Trigger Send to Clinic" conflicts with wording that says to show an action. It is unclear whether persistence is automatic or patient-confirmed. |
| Medium-risk advice | The boundary between prohibited advice and safe logistical/emergency guidance is undefined. |
| Continued high-risk chat | The permitted AI response scope after escalation remains unspecified. |
| Response expectation | The 12–18-hour expectation does not define business hours, delivery channel, SLA ownership, or its relationship to emergency guidance. |
| Citations | Approved sources, citation format, freshness requirements, and the definition of a resolving source span are unspecified. |
| Staff access scope | "All consented patients" could mean within the staff member's clinic or globally; tenant boundaries are not explicit. |
| Role distinctions | Staff, Nurse, and Clinician are named, but their distinct permissions are not defined. |
| Logs versus provenance | Original message provenance is required while raw content is prohibited in logs; the boundary between protected clinical records and operational logs is not explicitly described. |
| Redaction failure | Failure behavior must be documented, but the PDF does not explicitly require fail-closed processing or prescribe the user-facing response. |
| Latency | "Milliseconds" has no endpoint, percentile, or upper-bound acceptance criterion. |
| Marketing channels | The brief explicitly discusses further email marketing but not phone, SMS, social DM, or staff follow-up consent. |
| Voice fields | Required field names, storage, retention, consent, and relationships are unspecified. |
| Legal analysis | No evaluation date, authoritative sources, or exact channel scenarios are supplied for the required PDPA/MAB/platform-policy assessment. |
| Test filenames | `Test_guest_to_patient_conversion.py` has inconsistent capitalization, `test_escalation_payloa.py` appears truncated, and `test_trust` has no extension. |
| Required demo content | The video is mandatory, but the listed scenarios are only recommended; no minimum scenario set is specified. |

## 12. Pre-implementation decisions

Before implementation, obtain or record explicit decisions for at least:

1. Whether guest pages are part of the PWA exception to the authentication requirement.
2. Clinic/tenant boundaries for Staff, Nurse, and Clinician access.
3. Complete PHI redaction scope and fail-closed behavior.
4. Which two additional channel contracts satisfy the baseline.
5. Guest retention period and converted-message retention.
6. Whether Medium/ambiguous escalation is automatic or patient-confirmed.
7. Approved citation sources and citation representation.
8. Consent versioning, withdrawal, and allowed communication channels.
