// URLs of the API scheme (decisions/resources): everything campaign-scoped lives under
// `/api/campaigns/<id>`. Every entity is its own resource (decisions/resources), and no
// route answers under `entries/`: the cases use this URL to show that an
// address there names nothing.

/**
 * A URL under `entries/` — one encoded segment per address segment, so the
 * separators stay separators. A segment of nothing but dots is encoded
 * too: the URL parser would resolve `.`/`..` away before the server saw it,
 * and these tests mean to hand the address check exactly what was asked for.
 */
export function entriesUrl(campaign: string, address: string): string {
  const path = address.split("/").map(segment).join("/");
  return `/api/campaigns/${encodeURIComponent(campaign)}/entries/${path}`;
}

function segment(part: string): string {
  return /^\.+$/.test(part) ? part.replace(/\./g, "%2E") : encodeURIComponent(part);
}
