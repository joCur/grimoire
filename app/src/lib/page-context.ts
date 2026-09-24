// The hierarchical context of an entry view.
//
// The context line sits inside the page, next to the title it describes,
// rather than in the global chrome. Two rules follow:
//
//   1. The campaign name is NOT part of it. It appears exactly once in the
//      whole chrome, in the switcher; repeating it here reads as noise ("Der
//      Leuchtturm von Salzhafen / Kapitel 1: Der Leuchtturm von Salzhafen /
//      Fenn").
//   2. The context is the path the DM actually took, so an npc or a location
//      view points at ITS list — not at some chapter that happens to mention it,
//      which is misleading for an npc opened from the npc list.
//
// The scene's chapter comes from the ADDRESS, not from `chapter` properties:
// the address segment is always there, while the key may be missing or stale
// (the format degrades). The tree turns the id into the title.

import type { CampaignTree } from "@grimoire/shared/types";
import { kindFromAddress } from "@grimoire/shared/kind";

import type { Translate } from "@/i18n";
import { addressSegments } from "@/lib/address";
import { locationName } from "@/lib/campaign";
import { locationsHref, npcsHref } from "@/lib/open-target";

/** One step of the context line; without `to` it is plain text. */
export interface ContextCrumb {
  label: string;
  to?: string;
}

/**
 * Context crumbs for one entry view, outermost first. Empty for everything
 * that has no place in the hierarchy (the campaign entry, and any address the
 * schema does not describe) — the nav's section marking is context enough
 * there.
 *
 * Scene: `<chapter title> › <location>`, the chapter linking to the chapter
 * overview. The location part is the scene's middle segment resolved to a
 * display name (the location's name when the location exists, otherwise the
 * slug as written — never prettified), and is absent for a scene addressed
 * directly under its chapter.
 * Chapter entry: just the chapter, unlinked — it IS the chapter.
 * (An npc's and a location's reading views have their own routes and crumbs:
 * `npcPageCrumbs`, `locationPageCrumbs`.)
 *
 * The list labels come from the CATALOG via `t` — the crumb
 * says exactly what the list page it points at is titled, and this helper
 * stays language-free like every other one in lib/.
 */
export function pageContextCrumbs(
  campaign: string,
  path: string,
  tree: CampaignTree | undefined,
  t: Translate,
): ContextCrumb[] {
  if (campaign === "" || path === "") return [];
  const segments = addressSegments(path);

  switch (kindFromAddress(path)) {
    case "scene":
    case "chapter": {
      const chapterId = segments[0] ?? "";
      if (chapterId === "") return [];
      const title = tree?.chapters.find((c) => c.id === chapterId)?.title ?? chapterId;
      // The chapter overview is where the chapter's scenes live. Scrolling it to this
      // chapter would need an anchor in the chapter overview plus reduced-motion handling —
      // its own slice; the accordion already opens the active chapter.
      const crumbs: ContextCrumb[] = [{ label: title, to: `/campaigns/${campaign}` }];
      // `<chapter>/<location>/<scene>` — three segments means a location.
      const location = segments.length === 3 ? (segments[1] ?? "") : "";
      if (location !== "") crumbs.push({ label: locationName(tree, location) ?? location });
      return crumbs;
    }
    default:
      return [];
  }
}

/** The context of an npc's reading view: its list (ADR #31). */
export function npcPageCrumbs(campaign: string, t: Translate): ContextCrumb[] {
  if (campaign === "") return [];
  return [{ label: t("browse.title.npcs"), to: npcsHref(campaign) }];
}

/** The context of a location's reading view: its list (ADR #31). */
export function locationPageCrumbs(campaign: string, t: Translate): ContextCrumb[] {
  if (campaign === "") return [];
  return [{ label: t("browse.title.locations"), to: locationsHref(campaign) }];
}
