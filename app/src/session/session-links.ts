// Where a session lives in the app (ADR #31): the reading page of one
// evening, the live mode of the running one, and its wrap-up.

/** The reading page of one session. */
export function sessionHref(campaign: string, id: string): string {
  return `/campaigns/${campaign}/sessions/${encodeURIComponent(id)}`;
}

/** The live mode — where the running session is played. */
export function liveHref(campaign: string): string {
  return `/campaigns/${campaign}/live`;
}

/** The wrap-up of the last started session. */
export function reviewHref(campaign: string): string {
  return `/campaigns/${campaign}/review`;
}
