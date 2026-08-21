// The hierarchical context of a file view (issue #34, PO rework of PR #35).
//
// This is what the topbar breadcrumbs used to say — moved into the page, where
// it sits next to the title it describes instead of competing with the global
// chrome. Two rules come out of that move:
//
//   1. The campaign name is NOT part of it. It appears exactly once in the
//      whole chrome, in the switcher; repeating it here is what made the old
//      breadcrumb read as noise ("Der Leuchtturm von Salzhafen / Kapitel 1:
//      Der Leuchtturm von Salzhafen / Fenn").
//   2. The context is the path the DM actually took, so an npc/location view
//      points at ITS list — not at some chapter that happens to mention it,
//      which was misleading for an NPC opened from the NPC list.
//
// The scene's chapter comes from the PATH, not from `chapter` frontmatter: the
// directory is the filesystem truth and always there, while the key may be
// missing or stale (the format degrades). The tree turns the id into the title.

import type { CampaignTree } from "@grimoire/shared/types";
import { kindFromPath } from "@grimoire/shared/kind";

import { locationName } from "@/lib/campaign";

/** One step of the context line; without `to` it is plain text. */
export interface ContextCrumb {
  label: string;
  to?: string;
}

/**
 * Context crumbs for one file view, outermost first. Empty for everything
 * that has no place in the hierarchy (the campaign file, sessions, inbox,
 * glossary) — the nav's section marking is context enough there.
 *
 * Scene: `<chapter title> › <group>`, the chapter linking to the pool. The
 * group part is the scene's directory resolved like a pool group header (the
 * location's name when `locations/<slug>.md` exists, otherwise the slug as
 * written — never prettified), and is absent for a scene that sits directly
 * in the chapter directory.
 * Chapter file: just the chapter, unlinked — it IS the chapter.
 * NPC / location: their list.
 */
export function pageContextCrumbs(
  campaign: string,
  path: string,
  tree: CampaignTree | undefined,
): ContextCrumb[] {
  if (campaign === "" || path === "") return [];
  const segments = path.split("/");

  switch (kindFromPath(path)) {
    case "npc":
      return [{ label: "NPCs", to: `/${campaign}/list/npcs` }];
    case "location":
      return [{ label: "Orte", to: `/${campaign}/list/locations` }];
    case "scene":
    case "chapter": {
      const chapterId = segments[0] ?? "";
      if (chapterId === "") return [];
      const title = tree?.chapters.find((c) => c.id === chapterId)?.title ?? chapterId;
      // The pool is where the chapter's scenes live. Scrolling it to this
      // chapter would need a pool-side anchor plus reduced-motion handling —
      // its own slice; the accordion already opens the active chapter.
      const crumbs: ContextCrumb[] = [{ label: title, to: `/${campaign}` }];
      // `<chapter>/<group>/<scene>.md` — three segments means a group dir.
      const group = segments.length === 3 ? (segments[1] ?? "") : "";
      if (group !== "") crumbs.push({ label: locationName(tree, group) ?? group });
      return crumbs;
    }
    default:
      return [];
  }
}
