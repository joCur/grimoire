// The campaign's reference pages, named once.
//
// Four pages, four entry points, and they must not drift apart: the chapter overview's
// quiet line under the campaign header, the mobile start surface's rows, the
// ⌘K palette's navigation targets and (for two of them) the generator's
// context line. Each surface renders them its own way — that is what makes a
// phone row a phone row — but WHICH pages there are, what they are called and
// where they lead is decided here.
//
// NOT IN THE TOPBAR, deliberately. The topbar carries the three campaign-wide
// entries and stays as it is; a fourth and fifth link up there would crowd the
// one bar that has to survive every width, and „Glossar" is not something the
// DM reaches for mid-session.

import { BookA, Bookmark, Lightbulb, MapPin, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { MessageKey } from "@/i18n";

export interface LookupTarget {
  /** Stable key — also what a test or the palette identifies a row by. */
  id: "scenes" | "npcs" | "locations" | "glossary" | "knowledge";
  href: (campaign: string) => string;
  icon: LucideIcon;
  label: MessageKey;
}

/**
 * The reference pages, in the order every surface shows them: the three
 * derived from the campaign tree first, then the two the DM MAINTAINS.
 * Content you read before content you edit.
 */
export const LOOKUP_TARGETS: readonly LookupTarget[] = [
  {
    id: "scenes",
    href: (c) => `/campaigns/${c}/list/scenes`,
    icon: Bookmark,
    label: "browse.title.scenes",
  },
  { id: "npcs", href: (c) => `/campaigns/${c}/list/npcs`, icon: User, label: "browse.title.npcs" },
  {
    id: "locations",
    href: (c) => `/campaigns/${c}/list/locations`,
    icon: MapPin,
    label: "browse.title.locations",
  },
  { id: "glossary", href: (c) => `/campaigns/${c}/glossary`, icon: BookA, label: "glossary.title" },
  {
    id: "knowledge",
    href: (c) => `/campaigns/${c}/knowledge`,
    icon: Lightbulb,
    label: "knowledge.title",
  },
];

/**
 * The subset the DESKTOP chapter overview line shows. The scene list is left out there —
 * the chapter overview IS the scene list, so a link to a flat copy of what is on screen
 * says nothing. On the phone it stays: the mobile start surface is not a chapter overview.
 */
export const CHAPTER_OVERVIEW_LOOKUP_TARGETS = LOOKUP_TARGETS.filter((target) => target.id !== "scenes");
