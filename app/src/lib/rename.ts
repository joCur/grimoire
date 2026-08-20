// "Umbenennen" in the reading view (issue #30) — everything about it that is
// pure, so the dialog itself stays a thin shell.
//
// The id of an entity is its stable reference key (README), so a rename is a
// cascade the SERVER computes: the app only decides whether the file on
// screen can be renamed at all, validates the new id the same way the server
// does (fail before the request, not after it), and turns the server's
// answers into German lines.

import type { EntityKind } from "@grimoire/shared/types";

import { ApiError, type RenameKind } from "@/api";
import { fmString } from "@/lib/frontmatter";
import { isNpcSlug } from "@/lib/review";

export type { RenameKind };

export interface RenameTarget {
  kind: RenameKind;
  /** The id as it stands right now — what the cascade looks for. */
  oldId: string;
}

/** Reserved campaign directories; the server refuses them as an id. */
const RESERVED_IDS = new Set(["npcs", "locations", "sessions"]);

/** File name without directories and `.md` — the id a file degrades to. */
function fileStem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * What a rename would target for the file on screen, or undefined when the
 * file has no renameable id: sessions (their id is the date), the campaign
 * file, inbox, glossary, and anything unknown.
 *
 * For a chapter the id is its DIRECTORY name — `_chapter.md` is only the
 * chapter's metadata file, and the tree takes the id from the directory.
 * For every other kind it is the frontmatter id (which the parser already
 * falls back to the file stem).
 */
export function renameTargetFor(file: {
  path: string;
  kind: EntityKind;
  frontmatter: Record<string, unknown>;
}): RenameTarget | undefined {
  if (file.kind === "chapter") {
    const dir = file.path.slice(0, file.path.lastIndexOf("/"));
    // A `_chapter.md` always lives INSIDE its chapter directory; anything
    // else is not a chapter we can rename.
    return dir === "" || dir.includes("/") ? undefined : { kind: "chapter", oldId: dir };
  }
  if (file.kind !== "npc" && file.kind !== "location" && file.kind !== "scene") return undefined;
  const oldId = fmString(file.frontmatter.id) ?? fileStem(file.path);
  return oldId === "" ? undefined : { kind: file.kind, oldId };
}

/** German label of a rename kind, for the dialog copy. */
export function renameKindLabel(kind: RenameKind): string {
  switch (kind) {
    case "npc":
      return "NPC";
    case "location":
      return "Ort";
    case "scene":
      return "Szene";
    case "chapter":
      return "Kapitel";
  }
}

/**
 * Why this new id cannot be used, or undefined when it can — the same rules
 * the server enforces (kebab slug, not reserved, actually different), so the
 * dialog can block a request that would only come back as a 400.
 * An empty input is not an error, just not submittable.
 */
export function newIdError(newId: string, oldId: string): string | undefined {
  const id = newId.trim();
  if (id === "") return undefined;
  if (id === oldId) return "Unverändert — das ist schon die aktuelle id.";
  if (!isNpcSlug(id)) return "id braucht Kleinbuchstaben, Ziffern und einzelne Bindestriche.";
  if (RESERVED_IDS.has(id)) return "npcs, locations und sessions sind reservierte Namen.";
  return undefined;
}

/** True when this input can be sent (non-empty and without a rule violation). */
export function canSubmitNewId(newId: string, oldId: string): boolean {
  const id = newId.trim();
  return id !== "" && newIdError(id, oldId) === undefined;
}

/** „betrifft 1 Datei" / „betrifft 3 Dateien" — the preview's headline. */
export function changedCountLabel(count: number): string {
  return `betrifft ${count} ${count === 1 ? "Datei" : "Dateien"}`;
}

/**
 * The path the reading view must go to after the rename: the file on screen,
 * moved along with the rename. For npc/location/scene that is the renamed
 * file itself; for a chapter the DIRECTORY moved, so the `_chapter.md` we
 * were looking at sits under the new directory.
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

/** One quiet German line for a failed rename (or preview). */
export function renameErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Umbenennen fehlgeschlagen — Server prüfen.";
  const path = typeof error.details.path === "string" ? error.details.path : undefined;
  switch (error.status) {
    case 409:
      return path === undefined
        ? "Mehrere Dateien beanspruchen diese id — bitte extern aufräumen."
        : `${path} existiert schon — andere id wählen.`;
    case 404:
      return "Nicht gefunden — Ansicht neu laden.";
    case 400:
      return "id abgelehnt — Kleinbuchstaben, Ziffern und einzelne Bindestriche.";
    default:
      return "Umbenennen fehlgeschlagen — Server prüfen.";
  }
}
