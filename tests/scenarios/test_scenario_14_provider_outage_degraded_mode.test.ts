import { describe, expect, it, vi } from "vitest";

import { runPatientSafetyPipeline } from "../../src/features/patient-chat/pipeline";
import { DEGRADED_MODE_RESPONSE, HIGH_RISK_RESPONSE } from "../../src/features/risk/policy";

describe("test_scenario_14_provider_outage_degraded_mode", () => {
  it("renders deterministic safety-only mode for a provider outage", async () => {
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("secret provider detail"), { code: "provider" }));
    const result = await runPatientSafetyPipeline({ message: "Help me prepare for my appointment", sources: [], generate });
    expect(result.degradedMode).toBe(true);
    expect(result.risk.level).toBe("medium");
    expect(result.answer).toBe(DEGRADED_MODE_RESPONSE);
    expect(result.answer).toContain("safety-only mode");
    expect(result.answer).not.toContain("secret provider detail");
  });

  it("keeps emergency guidance provider-independent during the outage", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider down"));
    const result = await runPatientSafetyPipeline({ message: "Dada saya sakit, susah nak bernafas", sources: [], generate });
    expect(generate).not.toHaveBeenCalled();
    expect(result.risk.level).toBe("high");
    expect(result.answer).toBe(HIGH_RISK_RESPONSE);
  });
});
