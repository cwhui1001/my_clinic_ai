import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithProviderTimeout, ProviderRequestTimeoutError } from "../../src/server/openai/provider-timeout";

afterEach(() => vi.useRealTimers());

describe("test_scenario_13_provider_timeout", () => {
  it("aborts a hung provider at the explicit deadline", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as typeof fetch;

    const request = fetchWithProviderTimeout("https://example.test", {}, 15_000, fetchImplementation);
    const assertion = expect(request).rejects.toBeInstanceOf(ProviderRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
