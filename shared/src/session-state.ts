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

/**
 * True when a session file holds NOTHING the DM would miss (issue #40 AK7):
 * no log entry and no played scene. Only such a session may be DISCARDED
 * (POST /session/discard deletes the file); everything else is ended, not
 * deleted.
 *
 * Shared for the same reason `isEnded` is: the server decides whether the
 * delete is allowed, and the app decides whether to offer it at all — one
 * predicate, so the button is never there for a 409.
 *
 * "Empty body" is read generously: headings (`## Log` and friends) and blank
 * lines are the skeleton `startSession` writes, anything else — a log line,
 * a hand-typed note, a `## Threads` entry — is content.
 */
/**
 * One entry of the session's `pauses` list (issue #40 AK8): the wall-clock
 * strings as they stand in the file, zone-less like `started`/`ended` and
 * second-precise. A MISSING `to` means "paused right now".
 */
export interface SessionPause {
  from: string;
  to?: string;
}

function isTimestampish(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2}(:\d{2})?)?$/.test(value.trim());
}

/**
 * The USABLE `pauses` entries of a session's frontmatter, in file order —
 * shared so the server's runtime arithmetic and the client's fallback read
 * the same list out of the same hand-editable field.
 *
 * Degrade rules (README: the format degrades, it never throws):
 *   - no key / null -> empty list; a single mapping instead of a list is read
 *     as a one-element list.
 *   - an entry that is not a mapping, or whose `from` is not a timestamp-ish
 *     string, is DROPPED.
 *   - an entry whose `to` is present but not timestamp-ish is dropped as
 *     well: treating it as an OPEN interval would stop the session clock
 *     forever on a typo, which is worse than ignoring a broken pause.
 */
export function sessionPauses(frontmatter: Record<string, unknown> | undefined): SessionPause[] {
  const raw = frontmatter?.pauses;
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: SessionPause[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { from, to } = entry as Record<string, unknown>;
    if (!isTimestampish(from)) continue;
    if (to === undefined || to === null) {
      out.push({ from: from.trim() });
      continue;
    }
    if (!isTimestampish(to)) continue;
    out.push({ from: from.trim(), to: to.trim() });
  }
  return out;
}

/** The open (still running) pause of a session, if any — the LAST one wins. */
export function openPause(
  frontmatter: Record<string, unknown> | undefined,
): SessionPause | undefined {
  const open = sessionPauses(frontmatter).filter((p) => p.to === undefined);
  return open[open.length - 1];
}

/** True while the session is paused (an open `pauses` interval, AK8). */
export function isPaused(frontmatter: Record<string, unknown> | undefined): boolean {
  return openPause(frontmatter) !== undefined;
}

export function isSessionEmpty(
  frontmatter: Record<string, unknown> | undefined,
  body: string,
): boolean {
  const played = frontmatter?.scenes_played;
  if (Array.isArray(played) ? played.length > 0 : played !== undefined && played !== null) {
    return false;
  }
  return body
    .split(/\r?\n/)
    .every((line) => line.trim() === "" || /^#{1,6}(\s|$)/.test(line.trim()));
}
