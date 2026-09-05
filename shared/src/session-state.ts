// The session state machine, defined ONCE (issue #40 review).
//
// A session file is either RUNNING or ENDED, and exactly one predicate decides
// which: `isEnded`. It is shared on purpose — server (which file is active,
// which file may be written) and app (whether the live indicator stays up)
// used to each carry their own variant, and the variants disagreed about
// `ended: ""`, so a session could be invisible in the live topbar while the
// server still counted it as running.
//
// The decision: an EMPTY (or blank) `ended` counts as NOT SET — the session is
// running. Rationale: the value is hand-editable (DECISIONS #1), an empty key
// is the shape a half-finished manual edit leaves behind, and the readable
// consequence is "the session can be ended normally" instead of a zombie file
// that is neither active nor endable.

/** True when a frontmatter `ended` value marks the session as finished. */
export function isEndedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true; // a YAML date or any other non-empty scalar
}

/** True when this session file's frontmatter marks the session as finished. */
export function isEnded(frontmatter: Record<string, unknown> | undefined): boolean {
  return frontmatter !== undefined && isEndedValue(frontmatter.ended);
}
