import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const userSurfaces = applicationFiles(resolve("app"))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

describe("test_scenario_06_no_unearned_email_promise", () => {
  it("contains no promise to email a summary or notify through an unavailable channel", () => {
    expect(userSurfaces).not.toMatch(/(?:we(?:'ll| will)|will) email (?:you|your)|email(?:ed)? (?:you|your) (?:a )?(?:conversation )?summary/i);
    expect(userSurfaces).not.toMatch(/we(?:'ll| will) notify you/i);
  });

  it("does not hardcode a 12–18 hour response promise", () => {
    expect(userSurfaces).not.toMatch(/respond within\s*\{?.*12.*18.*hours/i);
    expect(userSurfaces).toContain("This is an expectation, not a guaranteed response time.");
  });
});

function applicationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? applicationFiles(path) : [path];
  });
}
