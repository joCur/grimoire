// URLs of the API scheme (ADR #22): everything campaign-scoped lives under
// `/api/campaigns/<id>`, and an entry's address is the path behind `entries/`.

/**
 * The request URL of one entry — one encoded segment per address segment, so
 * the separators stay separators. A segment of nothing but dots is encoded
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
