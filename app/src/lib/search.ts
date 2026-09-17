// Pure mapping logic for the ⌘K palette: kind → German label,
// kind → lucide icon (contingency scenes get the fork, like the pool view),
// result → route. Kept out of the component for unit tests.

import type { CampaignTree, SearchResult } from "@grimoire/shared/types";
import { BookMarked, BookOpen, Bookmark, FileText, GitFork, MapPin, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { MessageKey, Translate } from "@/i18n";

/**
 * The kind labels of the ⌘K results, per the design reference. From the
 * catalog since issue #69, with the translator PASSED IN (the lib layer never
 * decides the language) — and from the SAME `kind.*` keys the properties
 * dialog's title uses, so „Szene" is one string in one place.
 *
 * Unknown kinds pass through verbatim (degrade, README).
 */
const KIND_KEYS: Record<string, MessageKey> = {
  scene: "kind.scene",
  npc: "kind.npc",
  location: "kind.location",
  chapter: "kind.chapter",
  campaign: "kind.campaign",
};

export function kindLabel(kind: string, t: Translate): string {
  const key = KIND_KEYS[kind];
  return key === undefined ? kind : t(key);
}

/**
 * Icon per entity kind. The search result itself does not carry the scene
 * `type`, so contingency is derived from the (cache-shared) campaign tree
 * — see contingencyPaths(); without tree data every scene gets the bookmark.
 */
export function kindIcon(kind: string, isContingency = false): LucideIcon {
  switch (kind) {
    case "scene":
      return isContingency ? GitFork : Bookmark;
    case "npc":
      return User;
    case "location":
      return MapPin;
    case "chapter":
      return BookOpen;
    // The closed book next to the chapter's open one — the campaign is the
    // volume, a chapter is a page in it.
    case "campaign":
      return BookMarked;
    default:
      return FileText;
  }
}

/** Paths of all contingency scenes in the tree (fast lookup for kindIcon). */
export function contingencyPaths(tree: CampaignTree | undefined): Set<string> {
  const paths = new Set<string>();
  for (const chapter of tree?.chapters ?? []) {
    for (const group of chapter.groups) {
      for (const scene of group.scenes) {
        if (scene.type === "contingency") paths.add(scene.path);
      }
    }
  }
  return paths;
}

/**
 * Route for a picked result. Every kind opens as an entry view
 * (/campaigns/:campaign/entries/<path>) — except the campaign itself, whose "view" is the
 * pool. Path segments are encoded individually so umlauts and spaces in an address
 * survive, but the slashes stay routable.
 */
export function resultHref(campaign: string, result: Pick<SearchResult, "kind" | "path">): string {
  if (result.kind === "campaign") return `/campaigns/${encodeURIComponent(campaign)}`;
  const encodedPath = result.path.split("/").map(encodeURIComponent).join("/");
  return `/campaigns/${encodeURIComponent(campaign)}/entries/${encodedPath}`;
}
