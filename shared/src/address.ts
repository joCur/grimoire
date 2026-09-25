// Taking an ADDRESS apart — the one place a `/` in an address is read.
//
// An address is the string that names an entry (`campaign`, `<chapter>`; the
// schema is in server/src/store/paths.ts, which re-exports this function as
// the server's own door to it). Everything that wants a segment or a segment
// count reads it here, so the sentence "an address is a `/`-separated list of
// segments" stands in one module.
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
