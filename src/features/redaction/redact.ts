export const REDACTION_TOKEN = "[REDACTED]";
export const REDACTION_VERSION = "guest-phi-v1";

export type RedactionCategory = "email" | "phone" | "government_id" | "name";

export type RedactionResult = {
  text: string;
  categories: RedactionCategory[];
  counts: Partial<Record<RedactionCategory, number>>;
  version: typeof REDACTION_VERSION;
};

const NON_NAME_STARTERS = new Set([
  "are",
  "can",
  "could",
  "do",
  "does",
  "explain",
  "how",
  "is",
  "nightingale",
  "tell",
  "what",
  "when",
  "where",
  "which",
  "why",
  "would",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMatches(
  text: string,
  pattern: RegExp,
  category: RedactionCategory,
  counts: Partial<Record<RedactionCategory, number>>,
  replacement: string | ((substring: string, ...args: string[]) => string) =
    REDACTION_TOKEN,
) {
  return text.replace(pattern, (...args: string[]) => {
    counts[category] = (counts[category] ?? 0) + 1;
    return typeof replacement === "function"
      ? replacement(args[0], ...args.slice(1))
      : replacement;
  });
}

export function redactPhi(input: string, knownIdentifiers: string[] = []): RedactionResult {
  const counts: Partial<Record<RedactionCategory, number>> = {};
  let text = input;

  for (const identifier of knownIdentifiers.filter((value) => value.trim().length >= 2)) {
    text = replaceMatches(
      text,
      new RegExp(escapeRegExp(identifier.trim()), "gi"),
      "name",
      counts,
    );
  }

  text = replaceMatches(
    text,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "email",
    counts,
  );
  text = replaceMatches(
    text,
    /\b(?:[STFGM]\d{7}[A-Z]|\d{6}-?\d{2}-?\d{4})\b/gi,
    "government_id",
    counts,
  );
  text = replaceMatches(
    text,
    /(?<![A-Za-z0-9])(?:\+?60|0)(?:[\s-]?\d){9,10}(?![A-Za-z0-9])/g,
    "phone",
    counts,
  );
  text = replaceMatches(
    text,
    /\b(my name is|i am|i'm|this is)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})\b/gi,
    "name",
    counts,
    (_match, prefix) => `${prefix} ${REDACTION_TOKEN}`,
  );
  text = text.replace(
    /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g,
    (match, first: string, second: string) => {
      if (
        NON_NAME_STARTERS.has(first.toLowerCase()) ||
        ["clinic", "health", "hospital", "centre", "center"].includes(
          second.toLowerCase(),
        )
      ) {
        return match;
      }
      counts.name = (counts.name ?? 0) + 1;
      return REDACTION_TOKEN;
    },
  );

  return {
    text,
    categories: (Object.keys(counts) as RedactionCategory[]).filter(
      (category) => (counts[category] ?? 0) > 0,
    ),
    counts,
    version: REDACTION_VERSION,
  };
}

export function assertPhiSafe(text: string, knownIdentifiers: string[] = []) {
  const patterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:[STFGM]\d{7}[A-Z]|\d{6}-?\d{2}-?\d{4})\b/i,
    /(?<![A-Za-z0-9])(?:\+?60|0)(?:[\s-]?\d){9,10}(?![A-Za-z0-9])/,
  ];

  if (
    patterns.some((pattern) => pattern.test(text)) ||
    knownIdentifiers.some(
      (identifier) =>
        identifier.trim().length >= 2 &&
        text.toLowerCase().includes(identifier.trim().toLowerCase()),
    )
  ) {
    throw new Error("PHI redaction assertion failed.");
  }
}
