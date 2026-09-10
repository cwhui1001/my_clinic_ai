import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sanitizeAuditEntry } from "../../src/server/logging/sanitize";

describe("test_scenario_11_no_phi_egress", () => {
  it("drops PHI-shaped values from every structured audit field", () => {
    const marker = "Farah-900101-14-5678-farah@example.com";
    const serialized = JSON.stringify(sanitizeAuditEntry({
      action: marker,
      outcome: "failure",
      resourceId: marker,
      errorCode: marker,
    }));
    expect(serialized).not.toContain("Farah");
    expect(serialized).not.toContain("900101-14-5678");
    expect(serialized).not.toContain("farah@example.com");
    expect(serialized).toContain('"action":"invalid"');
  });

  it("keeps provider calls redacted, non-stored, bounded, and free of raw error bodies", () => {
    for (const file of ["guest-response.ts", "patient-response.ts"]) {
      const source = readFileSync(resolve(`src/server/openai/${file}`), "utf8");
      expect(source).toContain("redactedMessage");
      expect(source).toContain("store: false");
      expect(source).toContain("https://openrouter.ai/api/v1/responses");
      expect(source).toContain('data_collection: "deny"');
      expect(source).toContain("zdr: true");
      expect(source).toContain("fetchWithProviderTimeout");
      expect(source).not.toContain("https://api.openai.com");
      expect(source).not.toContain("OPENAI_API_KEY");
      expect(source).not.toMatch(/response\.text\(\)/);
    }
  });
});
