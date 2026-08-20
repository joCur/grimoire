// Pure mapping logic for the ⌘K palette (issue #7): kind → German label,
// kind → lucide icon (contingency scenes get the fork, like the pool view),
// result → route. Kept out of the component for unit tests.

import type { CampaignTree, SearchResult } from "@grimoire/shared/types";
import { BookMarked, BookOpen, Bookmark, FileText, GitFork, MapPin, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** German kind label per the design reference; unknown kinds pass through (degrade). */
export function kindLabel(kind: string): string {
  switch (kind) {
    case "scene":
      return "Szene";
    case "npc":
      return "NPC";
    case "location":
      return "Ort";
    case "chapter":
      return "Kapitel";
    case "campaign":
      return "Kampagne";
    default:
      return kind;
  }
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
 * Route for a picked result. Every kind opens as a file view
 * (/:campaign/file/<path>) — except the campaign itself, whose "view" is the
 * pool. Path segments are encoded individually so umlauts/spaces in filenames
 * survive, but the slashes stay routable.
 */
export function resultHref(campaign: string, result: Pick<SearchResult, "kind" | "path">): string {
  if (result.kind === "campaign") return `/${encodeURIComponent(campaign)}`;
  const encodedPath = result.path.split("/").map(encodeURIComponent).join("/");
  return `/${encodeURIComponent(campaign)}/file/${encodedPath}`;
}
