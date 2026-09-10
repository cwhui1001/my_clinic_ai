import type { MemorySourceIntegrity } from "@/src/types/memory";

export function resolveSourceIntegrity(
  capturedHash: string,
  currentHash: string | undefined,
): MemorySourceIntegrity {
  if (!currentHash) return "unavailable";
  return currentHash === capturedHash ? "verified" : "changed";
}
