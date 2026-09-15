// The id change (issue #30, demoted into the „Eigenschaften" footer by #77) —
// everything about it that is pure, so the dialog itself stays a thin shell.
//
// The id of an entity is its stable reference key (README), so a rename is a
// cascade the SERVER computes: the app only decides whether the file on
// screen can be renamed at all, validates the new id the same way the server
// does (fail before the request, not after it), and turns the server's
// answers into readable lines — in the UI language since issue #69, which is
// why every label function takes the translator as an argument instead of
// carrying copy of its own.

import type { EntityKind } from "@grimoire/shared/types";

import { ApiError, type RenameKind, type UsageGroup, type UsageRef, type UsageReport } from "@/api";
import type { Translate } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages";
import { fmString } from "@/lib/properties";
import { isNpcSlug } from "@/lib/review";

export type { RenameKind };

export interface RenameTarget {
  kind: RenameKind;
  /** The id as it stands right now — what the cascade looks for. */
  oldId: string;
}

/** Reserved campaign directories; the server refuses them as an id. */
const RESERVED_IDS = new Set(["npcs", "locations", "sessions"]);

/**
 * What a rename would target for the file on screen, or undefined when the
 * file has no renameable id: sessions (their id is the date), the campaign
 * file, inbox, glossary, and anything unknown.
 *
 * For a chapter the id is the FIRST PATH SEGMENT of its `_chapter` (the
 * chapter row's id). For every other kind it is `properties.id`, which every
 * document carries — it is the row's primary key, and the render layer puts
 * it in every properties mapping.
 */
export function renameTargetFor(file: {
  path: string;
  kind: EntityKind;
  properties: Record<string, unknown>;
}): RenameTarget | undefined {
  if (file.kind === "chapter") {
    const dir = file.path.slice(0, file.path.lastIndexOf("/"));
    // A `_chapter` always lives INSIDE its chapter directory; anything
    // else is not a chapter we can rename.
    return dir === "" || dir.includes("/") ? undefined : { kind: "chapter", oldId: dir };
  }
  if (file.kind !== "npc" && file.kind !== "location" && file.kind !== "scene") return undefined;
  const oldId = fmString(file.properties.id) ?? "";
  return oldId === "" ? undefined : { kind: file.kind, oldId };
}

/** Label of a rename kind, for the dialog copy (catalog, issue #69). */
export function renameKindLabel(kind: RenameKind, t: Translate): string {
  switch (kind) {
    case "npc":
      return t("rename.kind.npc");
    case "location":
      return t("rename.kind.location");
    case "scene":
      return t("rename.kind.scene");
    case "chapter":
      return t("rename.kind.chapter");
  }
}

/**
 * Why this new id cannot be used, or undefined when it can — the same rules
 * the server enforces (kebab slug, not reserved, actually different), so the
 * dialog can block a request that would only come back as a 400.
 * An empty input is not an error, just not submittable.
 */
export function newIdError(newId: string, oldId: string, t: Translate): string | undefined {
  const id = newId.trim();
  if (id === "") return undefined;
  if (id === oldId) return t("rename.error.unchanged");
  if (!isNpcSlug(id)) return t("rename.error.slug");
  if (RESERVED_IDS.has(id)) return t("rename.error.reserved");
  return undefined;
}

/** True when this input can be sent (non-empty and without a rule violation). */
export function canSubmitNewId(newId: string, oldId: string): boolean {
  const id = newId.trim();
  // Rule check only — the MESSAGE needs a language, the verdict does not, so
  // the catalog-free path stays available to callers without a translator.
  return id !== "" && (id === oldId ? false : isNpcSlug(id) && !RESERVED_IDS.has(id));
}

/** „betrifft 1 Eintrag" / „betrifft 3 Einträge" — the preview's headline
 *  (ICU plural in the catalog since #69). */
export function changedCountLabel(count: number, t: Translate): string {
  return t("rename.changed", { count });
}

// --- usage summary (issue #60) ----------------------------------------------

/**
 * The catalog key of each reference kind. The wire keeps stable English keys
 * (`UsageRef`); the sentence („3 Szenen, 2 Beziehungen, 4 Log-Zeilen" /
 * "3 scenes, 2 relationships, 4 log lines") is an ICU plural per key, so no
 * caller has to pick a form.
 *
 * `bodyRefs` (issue #68) is a body text that says `[[<id>]]` — „Textstelle"
 * is what the DM sees on the page, a name in running prose rather than a
 * properties field.
 */
const USAGE_REF_KEY: Record<UsageRef, MessageKey> = {
  sceneNpcs: "rename.usage.sceneNpcs",
  npcRelations: "rename.usage.npcRelations",
  sceneLocation: "rename.usage.sceneLocation",
  scenesPlayed: "rename.usage.scenesPlayed",
  logEntries: "rename.usage.logEntries",
  chapterScenes: "rename.usage.chapterScenes",
  chapterNpcs: "rename.usage.chapterNpcs",
  chapterLocations: "rename.usage.chapterLocations",
  bodyRefs: "rename.usage.bodyRefs",
};

/** „4 Log-Zeilen" — one group as a phrase. */
export function usageGroupLabel(group: UsageGroup, t: Translate): string {
  return t(USAGE_REF_KEY[group.ref], { count: group.count });
}

/**
 * The whole report in one line: „3 Szenen, 2 Beziehungen, 4 Log-Zeilen" —
 * or the honest empty case, which is the reassuring one before a rename.
 */
export function usageSummary(usage: UsageReport, t: Translate): string {
  if (usage.groups.length === 0) return t("rename.usage.none");
  return usage.groups.map((group) => usageGroupLabel(group, t)).join(", ");
}

/** „12 Verwendungen" / „1 Verwendung" — the summary's headline. */
export function usageTotalLabel(total: number, t: Translate): string {
  return t("rename.usage.total", { count: total });
}

/**
 * The path the reading view must go to after the rename: the file on screen,
 * moved along with the rename.
 *
 * The server names `from`/`to` in DOCUMENTS for every kind since the SQLite
 * cutover (#57) — a chapter rename reports `<id>/_chapter`, not the bare
 * directory — so the file on screen is usually `from` itself. The prefix
 * branch stays for the case where the view sits on something UNDER the
 * renamed address; it costs nothing and is the safe direction.
 */
export function renamedPath(
  currentPath: string,
  renamed: { from: string; to: string },
): string {
  if (currentPath === renamed.from) return renamed.to;
  if (currentPath.startsWith(`${renamed.from}/`)) {
    return `${renamed.to}${currentPath.slice(renamed.from.length)}`;
  }
  return currentPath;
}

/** One quiet line for a failed rename (or preview), in the UI language. */
export function renameErrorMessage(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t("rename.failed");
  const path = typeof error.details.path === "string" ? error.details.path : undefined;
  switch (error.status) {
    case 409:
      return path === undefined
        ? t("rename.conflict.ambiguous")
        : t("rename.conflict.path", { path });
    case 404:
      return t("rename.notFound");
    case 400:
      return t("rename.badId");
    default:
      return t("rename.failed");
  }
}
