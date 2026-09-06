// Defensive accessors for hand-edited properties (Record<string, unknown>).
// Mirrors the degrade rule: wrong-typed values yield undefined/empty, never
// an error.

/** Non-empty string or undefined. */
export function fmString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** String array; scalars are wrapped, null-ish members dropped. */
export function fmStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value.filter((v) => v !== undefined && v !== null).map((v) => String(v));
}

/** Quickstats entries as [key, value] string pairs; non-scalar values dropped. */
export function fmQuickstats(value: unknown): [string, string][] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => [k, String(v)]);
}
