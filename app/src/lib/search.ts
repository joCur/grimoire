// Pure mapping logic for the ⌘K palette: kind → readable label, kind → lucide
// icon (contingency scenes get the fork, like the chapter overview), result →
// route. Kept out of the component for unit tests.

import type { CampaignTree, SearchResult } from "@grimoire/shared/types";
import {
  BookA,
  BookMarked,
  BookOpen,
  Bookmark,
  FileText,
  GitFork,
  MapPin,
  NotebookPen,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { campaignHref } from "@/campaign/campaign-links";
import { chapterHref } from "@/chapter/chapter-links";
import type { MessageKey, Translate } from "@/i18n";
import { locationHref } from "@/location/location-links";
import { npcHref } from "@/npc/npc-links";
import { sceneHref } from "@/scene/scene-links";

/**
 * The kind labels of the ⌘K results, per the design reference. From the
 * catalog, with the translator PASSED IN (the lib layer never decides the
 * language) — and from the SAME `kind.*` keys the dialog titles use, so each
 * kind name is one string in one place.
 *
 * Unknown kinds pass through verbatim (degrade, README).
 */
const KIND_KEYS: Record<string, MessageKey> = {
  scene: "kind.scene",
  npc: "kind.npc",
  location: "kind.location",
  chapter: "kind.chapter",
  campaign: "kind.campaign",
  session: "kind.session",
  glossary: "kind.glossary",
};

export function kindLabel(kind: string, t: Translate): string {
  const key = KIND_KEYS[kind];
  return key === undefined ? kind : t(key);
}

/**
 * Icon per entity kind. The search result itself does not carry the scene
 * `type`, so contingency is derived from the (cache-shared) campaign tree
 * — see contingencyScenes(); without tree data every scene gets the bookmark.
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
    // A session is what was written down that evening, the glossary the
    // campaign's words.
    case "session":
      return NotebookPen;
    case "glossary":
      return BookA;
    default:
      return FileText;
  }
}

/** Ids of all contingency scenes in the tree (fast lookup for kindIcon). */
export function contingencyScenes(tree: CampaignTree | undefined): Set<string> {
  const ids = new Set<string>();
  for (const chapter of tree?.chapters ?? []) {
    for (const scene of chapter.scenes) {
      if (scene.type === "contingency") ids.add(scene.id);
    }
  }
  return ids;
}

/**
 * Route for a picked result. The campaign, a chapter, a scene, an npc and a
 * location open their own routes by their id — the route their slice names
 * (ADR #31), the campaign's being the chapter overview; a session opens its
 * reading page, a glossary term the glossary page.
 *
 * A kind nobody knows falls back to the chapter overview rather than building
 * a route out of nothing (degrade, README).
 */
export function resultHref(campaign: string, result: Pick<SearchResult, "kind" | "id">): string {
  const scope = campaignHref(campaign);
  switch (result.kind) {
    case "chapter":
      return chapterHref(encodeURIComponent(campaign), result.id);
    case "scene":
      return sceneHref(encodeURIComponent(campaign), result.id);
    case "npc":
      return npcHref(encodeURIComponent(campaign), result.id);
    case "location":
      return locationHref(encodeURIComponent(campaign), result.id);
    case "session":
      return `${scope}/sessions/${encodeURIComponent(result.id)}`;
    case "glossary":
      return `${scope}/glossary`;
    default:
      return scope;
  }
}
