// The hierarchical context of an entry view.
//
// The context line sits inside the page, next to the title it describes,
// rather than in the global chrome. Two rules follow:
//
//   1. The campaign name is NOT part of it. It appears exactly once in the
//      whole chrome, in the switcher; repeating it here reads as noise ("Der
//      Leuchtturm von Salzhafen / Kapitel 1: Der Leuchtturm von Salzhafen /
//      Fenn").
//   2. The context is the path the DM actually took, so an npc/location view
//      points at ITS list — not at some chapter that happens to mention it,
//      which is misleading for an NPC opened from the NPC list.
//
// The scene's chapter comes from the ADDRESS, not from `chapter` properties:
// the address segment is always there, while the key may be missing or stale
// (the format degrades). The tree turns the id into the title.

import type { CampaignTree } from "@grimoire/shared/types";
import { kindFromAddress } from "@grimoire/shared/kind";

import type { Translate } from "@/i18n";
import { locationName } from "@/lib/campaign";

/** One step of the context line; without `to` it is plain text. */
export interface ContextCrumb {
  label: string;
  to?: string;
}

/**
 * Context crumbs for one entry view, outermost first. Empty for everything
 * that has no place in the hierarchy (the campaign entry, sessions, inbox,
 * glossary) — the nav's section marking is context enough there.
 *
 * Scene: `<chapter title> › <group>`, the chapter linking to the chapter overview. The
 * group part is the scene's directory resolved like a chapter overview group header (the
 * location's name when `locations/<slug>` exists, otherwise the slug as
 * written — never prettified), and is absent for a scene that sits directly
 * in the chapter directory.
 * Chapter entry: just the chapter, unlinked — it IS the chapter.
 * NPC / location: their list.
 *
 * The two list labels come from the CATALOG via `t` — the crumb
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
  const segments = path.split("/");

  switch (kindFromAddress(path)) {
    case "npc":
      return [{ label: t("browse.title.npcs"), to: `/campaigns/${campaign}/list/npcs` }];
    case "location":
      return [{ label: t("browse.title.locations"), to: `/campaigns/${campaign}/list/locations` }];
    case "scene":
    case "chapter": {
      const chapterId = segments[0] ?? "";
      if (chapterId === "") return [];
      const title = tree?.chapters.find((c) => c.id === chapterId)?.title ?? chapterId;
      // The chapter overview is where the chapter's scenes live. Scrolling it to this
      // chapter would need an anchor in the chapter overview plus reduced-motion handling —
      // its own slice; the accordion already opens the active chapter.
      const crumbs: ContextCrumb[] = [{ label: title, to: `/campaigns/${campaign}` }];
      // `<chapter>/<group>/<scene>` — three segments means a group dir.
      const group = segments.length === 3 ? (segments[1] ?? "") : "";
      if (group !== "") crumbs.push({ label: locationName(tree, group) ?? group });
      return crumbs;
    }
    default:
      return [];
  }
}
