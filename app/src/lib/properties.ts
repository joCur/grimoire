// Defensive accessors for an entry's properties (Record<string, unknown>):
// they are typed per kind by convention, not by the store, so a reader takes
// what it can use and ignores the rest. Mirrors the degrade rule: wrong-typed
// values yield undefined/empty, never an error.

/** Non-empty string or undefined. */
export function propString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** String array; scalars are wrapped, null-ish members dropped. */
export function propStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value.filter((v) => v !== undefined && v !== null).map((v) => String(v));
}
