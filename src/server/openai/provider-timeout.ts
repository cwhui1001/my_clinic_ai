export class ProviderRequestTimeoutError extends Error {
  constructor() {
    super("provider_timeout");
    this.name = "ProviderRequestTimeoutError";
  }
}

export async function fetchWithProviderTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new ProviderRequestTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
