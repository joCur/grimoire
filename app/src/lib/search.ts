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
  Inbox,
  MapPin,
  NotebookPen,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { MessageKey, Translate } from "@/i18n";
import { encodeAddress } from "@/lib/address";

/**
 * The kind labels of the ⌘K results, per the design reference. From the
 * catalog, with the translator PASSED IN (the lib layer never decides the
 * language) — and from the SAME `kind.*` keys the properties dialog's title
 * uses, so each kind name is one string in one place.
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
  inbox: "kind.inbox",
  glossary: "kind.glossary",
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
    // The three that are lists rather than entries: a session is what was
    // written down that evening, the inbox what was thrown in on the go, the
    // glossary the campaign's words.
    case "session":
      return NotebookPen;
    case "inbox":
      return Inbox;
    case "glossary":
      return BookA;
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
 * Route for a picked result. An entry opens as an entry view
 * (/campaigns/:campaign/entries/<path>); the kinds that are no longer entries
 * open the page that HOLDS them — a session its reading page, an idea the
 * wrap-up it is waiting in, a term the glossary page — and the campaign
 * itself opens the chapter overview.
 *
 * A result without a `path` can only be one of those kinds, so an unknown one
 * falls back to the chapter overview rather than building an entry address out
 * of nothing (degrade, README).
 */
export function resultHref(
  campaign: string,
  result: Pick<SearchResult, "kind" | "id" | "path">,
): string {
  const scope = `/campaigns/${encodeURIComponent(campaign)}`;
  switch (result.kind) {
    case "campaign":
      return scope;
    case "session":
      return `${scope}/sessions/${encodeURIComponent(result.id)}`;
    case "inbox":
      return `${scope}/review`;
    case "glossary":
      return `${scope}/glossary`;
    default:
      return result.path === undefined
        ? scope
        : `${scope}/entries/${encodeAddress(result.path)}`;
  }
}
