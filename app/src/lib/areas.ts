// The areas of a campaign, named once.
//
// An area is a place of the campaign the DM goes to: the chapters, the lists
// of scenes, NPCs and locations, the reference pages, the session review
// and the trash. Each has exactly ONE entry point in the UI, the campaign menu
// in the topbar (components/CampaignMenu.tsx), and the ⌘K palette reaches the
// same list. Both read it from here, so a new area is one new row below and
// appears in both at once.
//
// Which area the current view belongs to is answered from the route alone —
// no query, no waiting, no flicker between "unmarked" and "marked". A reading
// view belongs to the area whose list it came from: a scene to the scenes, an
// NPC to the NPCs, a chapter to the chapters. Views that belong to no area
// (the live mode, the generator, a past session's reading page, the settings)
// name only the campaign — an arbitrary area would be a lie.

import {
  BookA,
  BookOpen,
  Bookmark,
  ClipboardCheck,
  Coins,
  Lightbulb,
  MapPin,
  Trash2,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { matchPath } from "react-router";

import type { MessageKey } from "@/i18n";
import { glossaryHref } from "@/glossary-term/glossary-term-links";
import { itemPricesHref } from "@/item-price/item-price-links";
import { locationsHref } from "@/location/location-links";
import { npcsHref } from "@/npc/npc-links";
import { reviewHref } from "@/session/session-links";

/** The three groups of the menu, in the order it shows them. */
export type AreaGroup = "prepare" | "lookUp" | "tidyUp";

export interface Area {
  /** Stable key — also what a test or the palette identifies a row by. */
  id:
    | "chapters"
    | "scenes"
    | "npcs"
    | "locations"
    | "glossary"
    | "knowledge"
    | "itemPrices"
    | "review"
    | "trash";
  group: AreaGroup;
  href: (campaign: string) => string;
  icon: LucideIcon;
  label: MessageKey;
  /** The routes that belong to the area, below `/campaigns/:campaign`. */
  routes: readonly string[];
}

/**
 * Every area, grouped by what the DM does there: what they write and order
 * before the evening, what they look up at the table, and what is left to
 * sort out afterwards.
 */
export const AREAS: readonly Area[] = [
  {
    id: "chapters",
    group: "prepare",
    href: (c) => `/campaigns/${c}`,
    icon: BookOpen,
    label: "area.chapters",
    routes: ["", "chapters/:id"],
  },
  {
    id: "scenes",
    group: "prepare",
    href: (c) => `/campaigns/${c}/scenes`,
    icon: Bookmark,
    label: "area.scenes",
    routes: ["scenes", "scenes/:id"],
  },
  {
    id: "npcs",
    group: "prepare",
    href: npcsHref,
    icon: User,
    label: "area.npcs",
    routes: ["npcs", "npcs/:id"],
  },
  {
    id: "locations",
    group: "prepare",
    href: locationsHref,
    icon: MapPin,
    label: "area.locations",
    routes: ["locations", "locations/:id"],
  },
  {
    id: "glossary",
    group: "lookUp",
    href: glossaryHref,
    icon: BookA,
    label: "area.glossary",
    routes: ["glossary"],
  },
  {
    id: "knowledge",
    group: "lookUp",
    href: (c) => `/campaigns/${c}/knowledge`,
    icon: Lightbulb,
    label: "area.knowledge",
    routes: ["knowledge"],
  },
  {
    id: "itemPrices",
    group: "lookUp",
    href: (c) => itemPricesHref(c),
    icon: Coins,
    label: "area.itemPrices",
    routes: ["item-prices"],
  },
  {
    id: "review",
    group: "tidyUp",
    href: reviewHref,
    icon: ClipboardCheck,
    label: "area.review",
    routes: ["review"],
  },
  {
    id: "trash",
    group: "tidyUp",
    href: (c) => `/campaigns/${c}/trash`,
    icon: Trash2,
    label: "area.trash",
    routes: ["trash"],
  },
];

/** The groups with their headings, in menu order. */
export const AREA_GROUPS: readonly { id: AreaGroup; label: MessageKey }[] = [
  { id: "prepare", label: "campaignMenu.group.prepare" },
  { id: "lookUp", label: "campaignMenu.group.lookUp" },
  { id: "tidyUp", label: "campaignMenu.group.tidyUp" },
];

/** The areas of one group, in list order. */
export function areasOf(group: AreaGroup): Area[] {
  return AREAS.filter((area) => area.group === group);
}

/** The area the view at `pathname` belongs to, or undefined for none. */
export function currentArea(pathname: string): Area | undefined {
  return AREAS.find((area) =>
    area.routes.some(
      (route) =>
        matchPath(route === "" ? "/campaigns/:campaign" : `/campaigns/:campaign/${route}`, pathname) !==
        null,
    ),
  );
}
