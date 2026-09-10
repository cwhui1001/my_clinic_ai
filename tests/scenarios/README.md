# Judge Scenario Test Matrix

This directory maps every scenario in `48HR Feedback_ Nightingale Candidate Brief.pdf` to an explicitly named automated test. A passing source/SQL contract test is evidence that the intended production call path is wired in the repository; it is not presented as proof that a hosted database, browser, scheduler, or delivery provider executed the behavior.

Run the local scenario suite:

```powershell
npm test -- --run tests/scenarios
```

Run all local tests:

```powershell
npm test
```

| Scenario | Primary automated test | What is actually exercised | Honest scope |
|---:|---|---|---|
| 01 | `test_scenario_01_response_delivery.test.ts` | Production notification payload and return-path parser; response/outbox/delivery wiring contracts | PARTIAL: no real browser push delivery or retry worker execution |
| 02 | `test_scenario_02_phone_social_identity.test.ts` | Phone/social capture, OTP route, conversion, and contact-provenance contracts | PARTIAL: submitted SMS provider is disabled; no hosted OTP delivery |
| 03 | `test_scenario_03_expired_cross_device_recovery.test.ts` | Fragment/POST/token-rotation and active/expired/purged UI/database contracts | PARTIAL: no browser E2E and no channel delivers the recovery link |
| 04 | `test_scenario_04_value_and_guest_visibility.test.ts`; `test_scenario_04_guest_visibility.test.ts` | Production value predicate plus conversion/RLS contracts | PARTIAL: hosted negative suite is opt-in and not part of the normal run |
| 05 | `test_scenario_05_attribution_minimisation.test.ts` | Production escalation-attribution schema, identity preservation, and PII rejection contracts | PARTIAL: no hosted three-hop LeadSession → PatientSession → Escalation execution |
| 06 | `test_scenario_06_no_unearned_email_promise.test.ts` | Scans every current user-facing `app/**/*.tsx` surface for unsupported promises | SURVIVES for current surfaces; no email transport is claimed |
| 07 | `test_scenario_07_separate_consents.test.ts` | Production Zod consent contract/default-off behavior plus append-only SQL contract | PARTIAL: hosted grant/withdraw/query flow is not executed |
| 08 | `test_scenario_08_unlowerable_emergency_floor.test.ts` | Executes the production safety pipeline and `maxRiskDecision` | SURVIVES for tested rules |
| 09 | `test_scenario_09_multilingual_emergency_floor.test.ts` | Executes guest/patient EN, MS, mixed, Simplified Chinese, and Traditional Chinese rules | SURVIVES for tested phrases |
| 10 | `test_scenario_10_risk_redaction_order_mykad.test.ts` | Executes MyKad redaction/fail-closed provider boundary; inspects persistence ordering | SURVIVES for tested identifier/order cases |
| 11 | `test_scenario_11_no_phi_egress.test.ts` | Executes the production audit sanitizer and inspects provider request/error contracts | PARTIAL: hosting/APM/provider retention cannot be established locally |
| 12 | `test_scenario_12_guest_boundary_retention.test.ts` | Verifies called rate-limit/read/cleanup contracts | PARTIAL: `test_scenarios_04_12_hosted_boundary.test.ts` is opt-in and scheduler execution is unproven |
| 13 | `test_scenario_13_provider_timeout.test.ts` | Executes a hung fetch with fake time and proves AbortController fires at 15 seconds | SURVIVES for the provider request boundary |
| 14 | `test_scenario_14_provider_outage_degraded_mode.test.ts` | Executes provider failure and provider-independent Malay emergency behavior | PARTIAL operationally: no circuit breaker/outage monitor |
| 15 | `test_scenario_15_output_diagnosis_gate.test.ts` | Executes guest and patient output gates with unsafe diagnostic drafts | SURVIVES for tested patterns |
| 16 | `test_scenario_16_correction_chain.test.ts` | Executes production extraction for correction-of-correction; inspects append-only SQL writer | PARTIAL: no hosted three-revision database mutation test |
| 17 | `test_scenario_17_guest_memory_conversion.test.ts` | Executes guest fact extraction; verifies production conversion/bootstrap/no-repeat wiring | PARTIAL: hosted conversion/bootstrap is not executed |
| 18 | `test_scenario_18_cold_handoff_payload.test.ts`; `tests/unit/escalation-payload.test.ts` group `test_scenario_18_cold_handoff_payload_builder` | Executes production schemas and payload builder | PARTIAL: no hosted queue-to-clinician-page integration |
| 19 | `test_scenario_19_safety_critical_contradictions.test.ts` | Executes extraction and clinician payload conflict visibility; inspects SQL trigger | PARTIAL: PostgreSQL conflict trigger/resolution workflow is not executed |
| 20 | `test_scenario_20_multiclinic_isolation.test.ts`; `test_scenario_20_cross_clinic_isolation.test.ts` | Verifies RLS-first/service-role contracts | PARTIAL: hosted two-clinic negative suite is opt-in |
| 21 | `test_scenario_21_provenance_integrity.test.ts` | Executes source-integrity resolver and verifies immutable capture/UI contracts | PARTIAL: no hosted source mutation/deletion execution |

## Opt-in hosted suites

These tests create and delete synthetic hosted Supabase records. Run them only against a non-production project with all migrations applied.

```powershell
$env:RUN_HOSTED_BOUNDARY_TESTS = "1"
npm test -- --run tests/integration/test_scenarios_04_12_hosted_boundary.test.ts
Remove-Item Env:\RUN_HOSTED_BOUNDARY_TESTS

$env:RUN_HOSTED_TENANT_TESTS = "1"
npm test -- --run tests/integration/test_scenario_20_hosted_multiclinic_isolation.test.ts
Remove-Item Env:\RUN_HOSTED_TENANT_TESTS
```

The normal test suite skips both hosted suites. A skip is not evidence that scenarios 04, 12, or 20 survive in the deployed project.
