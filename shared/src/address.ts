// Taking an ADDRESS apart — the one place a `/` in an address is read.
//
// An address is the string that names an entry (`<chapter>`,
// `<chapter>/<location>/<scene-id>`; the schema is in
// server/src/store/paths.ts, which re-exports these two functions as the
// server's own door to them). Everything that wanted a chapter segment, a last
// segment or a segment count used to write `rel.split("/")` itself, which meant
// the sentence "an address is a `/`-separated list of segments" stood in ten
// modules and could be got subtly wrong in each — a filter here, an `?? ""`
// there.
//
// It lives in shared/ and not next to the schema because the app needs it too
// (`kindFromAddress` in ./kind is written against these segments), and shared/
// may never depend on the server.

/**
 * The segments of an address, verbatim and in order.
 *
 * Nothing is filtered and nothing is trimmed: a leading, trailing or doubled
 * `/` produces an EMPTY segment, and that is information — it is what makes
 * `01-salzhafen/` a two-segment address that names nothing rather than a
 * one-segment address that names the chapter. A caller that wants an address
 * without its blanks says so (./kind does).
 */
export function addressSegments(address: string): string[] {
  return address.split("/");
}

/**
 * The FIRST segment of an address, `""` for the empty string. For a scene
 * that is the segment the rest hangs off: its chapter.
 */
export function addressHead(address: string): string {
  return addressSegments(address)[0] ?? "";
}
