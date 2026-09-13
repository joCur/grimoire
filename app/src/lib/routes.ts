// First path segments that are ROUTES, not campaign ids (issue #69).
//
// `/:campaign` is the app's widest route by design — a campaign id is a
// directory name, so anything can be one — and that makes every NON-campaign
// top-level segment a special case that has to be named exactly once. This
// module is that one place; App.tsx and the topbar both read it.
//
// Two consumers, one question:
//
//   * App.tsx sends `/settings/anything` back to the page it belongs to.
//     A sibling `settings/*` route cannot do that job: React Router ranks
//     `:campaign/list/:kind` (3+10+3) ABOVE `settings/*` (10 minus the splat
//     penalty), so the campaign route keeps winning — the check has to sit
//     INSIDE the campaign scope, where the segment is already known.
//   * The topbar derives the campaign from the URL with its own `matchPath`
//     calls, and `"/:campaign"` happily matches `/settings` with
//     `campaign: "settings"` — which dressed the settings page in a full
//     campaign chrome ("Kampagne: settings", the nav trio pointing at
//     `/settings/list/npcs`, a session query for a campaign that does not
//     exist).
//
// A campaign whose id collided with one of these would be unreachable anyway.

/** The non-campaign top-level segments, i.e. the routes App.tsx declares. */
export const NON_CAMPAIGN_SEGMENTS: ReadonlySet<string> = new Set(["settings", "dev"]);

/**
 * Where a URL below a non-campaign segment belongs — the page the DM was
 * aiming at, never a half-empty campaign view with no way out (PR #83
 * review). `undefined` for a real campaign id, which is the normal case.
 *
 * Every target is a route that does NOT enter the campaign scope, so no
 * redirect can loop back in here.
 */
export function nonCampaignRedirect(segment: string): string | undefined {
  switch (segment) {
    case "settings":
      return "/settings";
    // The dev-only markdown harness: `/dev/markdown` matches its own static
    // route, anything else under it is nothing at all.
    case "dev":
      return "/";
    default:
      return undefined;
  }
}
