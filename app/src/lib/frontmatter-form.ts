// „Eigenschaften" — editing ALL frontmatter fields of one file from the app
// (issue #42, slice 2a of #15). This module is the pure half: which fields a
// kind has, what the open form starts with, and the PATCH body a save sends.
// No react, no query imports, so every rule here is unit-testable.
//
// Three rules carry the whole thing:
//
//   1. The FIELD LIST comes from the entity types in @grimoire/shared — one
//      list per kind, `id` deliberately absent (the rename cascade of issue
//      #30 owns it) and the kind itself as well (it is derived from the path).
//   2. Only what the DM CHANGED is patched. PATCH /frontmatter re-emits the
//      whole YAML block from the parsed file, so every key we do not send
//      keeps its value — unknown keys of a hand-edited file included. Sending
//      an unchanged field would be a no-op at best and a type/format change at
//      worst (`quickstats: {wis: 2}` -> `{wis: '2'}`).
//   3. Clearing a field DELETES the key (`null`, the server's delete marker)
//      instead of writing an empty value — `tags: []` or `role: ''` is noise
//      in a file the DM also reads in an editor. Same choice the campaign
//      metadata dialog made for a blank description (issue #34).
//
// The format DEGRADES (README): an unknown `status`/`type` value is offered as
// its own option instead of being corrected away, a reference field takes a
// free-text id that has no file yet, and a wrong-typed value is shown as text
// rather than throwing.

import {
  NPC_STATUSES,
  SCENE_TYPES,
  type CampaignTree,
  type EntityKind,
} from "@grimoire/shared/types";

import { fetchFile, patchFrontmatter } from "@/api";
import { isEntityId, npcStatusLabel } from "@/lib/entity";
import { fmQuickstats, fmStringArray } from "@/lib/frontmatter";
import { SCENE_STATUS_OPTIONS } from "@/lib/scene-status";
import { writeWithMtime, type MtimeWriteResult } from "@/lib/write-with-mtime";

/** The kinds whose frontmatter the form knows (README entity sections). */
export type FrontmatterKind = "scene" | "npc" | "location" | "chapter";

/**
 * How one field is edited:
 *
 *   text / textarea   free string (textarea = the fields that hold a sentence)
 *   select            a known value set, plus whatever stands in the file
 *   reference         ONE id of an existing entity, free text allowed
 *   references        MANY such ids, as chips
 *   chips             free string list (`tags`, `handouts`)
 *   pairs             free key/value map (`quickstats`)
 */
export type FieldControl =
  | "text"
  | "textarea"
  | "select"
  | "reference"
  | "references"
  | "chips"
  | "pairs";

/** Which tree list a reference field offers (free text stays possible). */
export type ReferenceSource = "npcs" | "locations" | "chapters";

export interface FieldOption {
  /** What is written to the file. */
  value: string;
  /** What the DM reads — the entity's name/title, or the value itself. */
  label: string;
}

export interface FrontmatterField {
  /** The frontmatter key, verbatim (`roll20-page` included). */
  key: string;
  /** German label above the control. */
  label: string;
  control: FieldControl;
  /** Quiet German line under the control; the format's own note in most cases. */
  hint?: string;
  /** A field the entity cannot lose (`title`/`name`) — blank blocks the save. */
  required?: boolean;
  placeholder?: string;
  /** `select` only: the known value set. */
  options?: readonly FieldOption[];
  /** `reference`/`references` only: which tree list to offer. */
  source?: ReferenceSource;
}

const SCENE_TYPE_LABELS: Record<string, string> = {
  planned: "geplant",
  contingency: "Kontingenz",
};

/** SCENE_TYPES is the single source; the labels are the reading view's words. */
const SCENE_TYPE_OPTIONS: readonly FieldOption[] = SCENE_TYPES.map((value) => ({
  value,
  label: SCENE_TYPE_LABELS[value] ?? value,
}));

const NPC_STATUS_OPTIONS: readonly FieldOption[] = NPC_STATUSES.map((value) => ({
  value,
  label: npcStatusLabel(value),
}));

/** SceneFrontmatter without `id` (README, „Entität: Szene"). */
const SCENE_FIELDS: readonly FrontmatterField[] = [
  { key: "title", label: "Titel", control: "text", required: true },
  { key: "type", label: "Typ", control: "select", options: SCENE_TYPE_OPTIONS },
  {
    key: "trigger",
    label: "Auslöser",
    control: "textarea",
    hint: "Nur bei Kontingenz: wann feuert die Szene?",
  },
  { key: "chapter", label: "Kapitel", control: "reference", source: "chapters" },
  {
    key: "location",
    label: "Ort",
    control: "reference",
    source: "locations",
    hint: "id aus Orte oder freier Text.",
  },
  {
    key: "npcs",
    label: "NPCs",
    control: "references",
    source: "npcs",
    // Unlike `location` this list has no free-text half: every entry is an id
    // that gets a card and, on save, an entry (#70).
    hint: "Nur ids — unbekannte werden beim Speichern angelegt.",
  },
  {
    key: "handouts",
    label: "Handouts",
    control: "chips",
    hint: "Name des Roll20-Handouts, nur ein Verweis.",
  },
  {
    key: "tags",
    label: "Tags",
    control: "chips",
    hint: "Frei; empfohlen: combat, social, stealth, travel.",
  },
  { key: "status", label: "Status", control: "select", options: SCENE_STATUS_OPTIONS },
];

/** NpcFrontmatter without `id` (README, „Entität: NPC"). */
const NPC_FIELDS: readonly FrontmatterField[] = [
  { key: "name", label: "Name", control: "text", required: true },
  { key: "role", label: "Rolle", control: "text", hint: "Ein Einzeiler." },
  {
    key: "chapter",
    label: "Kapitel",
    control: "reference",
    source: "chapters",
    hint: "Wo der NPC eingeführt wird.",
  },
  { key: "status", label: "Status", control: "select", options: NPC_STATUS_OPTIONS },
  {
    key: "statblock",
    label: "Statblock",
    control: "text",
    placeholder: "Roll20: Fenn",
    hint: "Verweis auf das Roll20-Sheet, keine Kopie.",
  },
  {
    key: "quickstats",
    label: "Quickstats",
    control: "pairs",
    hint: "Frei — nur was sozial gebraucht wird, z. B. insight +2.",
  },
  { key: "voice", label: "Stimme", control: "textarea", hint: "Wie klingt er/sie?" },
  { key: "appearance", label: "Erscheinung", control: "textarea", hint: "Ein bis zwei Merkmale." },
];

/** LocationFrontmatter without `id` (README, „Entität: Ort"). */
const LOCATION_FIELDS: readonly FrontmatterField[] = [
  { key: "name", label: "Name", control: "text", required: true },
  { key: "chapter", label: "Kapitel", control: "reference", source: "chapters" },
  {
    key: "roll20-page",
    label: "Roll20-Seite",
    control: "text",
    hint: "Verweis auf die Page, keine Karten-Kopie.",
  },
];

/** ChapterFrontmatter without `id` (the id is the chapter DIRECTORY). */
const CHAPTER_FIELDS: readonly FrontmatterField[] = [
  { key: "title", label: "Titel", control: "text", required: true },
  {
    key: "status",
    label: "Status",
    control: "text",
    placeholder: "active",
    hint: "Der Wert active markiert das Kapitel, das die Live-Ansicht öffnet.",
  },
];

const FIELDS_BY_KIND: Record<FrontmatterKind, readonly FrontmatterField[]> = {
  scene: SCENE_FIELDS,
  npc: NPC_FIELDS,
  location: LOCATION_FIELDS,
  chapter: CHAPTER_FIELDS,
};

/**
 * The fields of a kind, or undefined when the reading view offers no
 * „Eigenschaften" at all:
 *
 *   campaign          has its own metadata dialog (issue #34)
 *   session / inbox   app-managed, append-only (ADR #4)
 *   glossary/unknown  no typed frontmatter to offer
 */
export function frontmatterFieldsFor(kind: EntityKind): readonly FrontmatterField[] | undefined {
  switch (kind) {
    case "scene":
    case "npc":
    case "location":
    case "chapter":
      return FIELDS_BY_KIND[kind];
    default:
      return undefined;
  }
}

/** German label of the kind for the dialog title („NPC-Eigenschaften"). */
export function frontmatterKindLabel(kind: EntityKind): string | undefined {
  switch (kind) {
    case "scene":
      return "Szene";
    case "npc":
      return "NPC";
    case "location":
      return "Ort";
    case "chapter":
      return "Kapitel";
    default:
      return undefined;
  }
}

// --- form state --------------------------------------------------------------

/** One field's edit state; the shape follows the control, not the value. */
export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "pairs"; entries: readonly { key: string; value: string }[] };

export type FormValues = Record<string, FieldValue>;

/** Which state shape a control edits. */
export function fieldValueKind(control: FieldControl): FieldValue["kind"] {
  switch (control) {
    case "references":
    case "chips":
      return "list";
    case "pairs":
      return "pairs";
    default:
      return "text";
  }
}

/**
 * A scalar frontmatter value as editable text. Numbers and booleans are shown
 * verbatim instead of being dropped (degrade — a hand-edited `roll20-page: 12`
 * is text to the DM); anything structural becomes an empty field, and since an
 * untouched field is never patched, nothing is lost by that.
 */
function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** What the form starts with — the file's current values, field by field. */
export function frontmatterFormValues(
  fields: readonly FrontmatterField[],
  frontmatter: Record<string, unknown>,
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = frontmatter[field.key];
    switch (fieldValueKind(field.control)) {
      case "list":
        values[field.key] = { kind: "list", items: fmStringArray(raw) };
        break;
      case "pairs":
        values[field.key] = {
          kind: "pairs",
          entries: fmQuickstats(raw).map(([key, value]) => ({ key, value })),
        };
        break;
      default:
        values[field.key] = { kind: "text", text: scalarText(raw) };
    }
  }
  return values;
}

/**
 * Trimmed, without the empties — the shape a value is COMPARED and WRITTEN in.
 * Normalizing both sides of the comparison is what keeps a field the DM only
 * clicked into out of the patch.
 */
function normalize(value: FieldValue): FieldValue {
  switch (value.kind) {
    case "text":
      return { kind: "text", text: value.text.trim() };
    case "list":
      return {
        kind: "list",
        items: value.items.map((item) => item.trim()).filter((item) => item !== ""),
      };
    case "pairs":
      return {
        kind: "pairs",
        // A row without a VALUE is a deleted key, never `key: ''` (rule 3) —
        // and a row without a KEY cannot be written at all. The latter is not
        // silently dropped, though: frontmatterFormIssues blocks the save
        // while such a row still holds text (see there).
        entries: value.entries
          .map((entry) => ({ key: entry.key.trim(), value: entry.value.trim() }))
          .filter((entry) => entry.key !== "" && entry.value !== ""),
      };
  }
}

/** True when a normalized value holds nothing — the „delete the key" case. */
function isEmpty(value: FieldValue): boolean {
  switch (value.kind) {
    case "text":
      return value.text === "";
    case "list":
      return value.items.length === 0;
    case "pairs":
      return value.entries.length === 0;
  }
}

/**
 * Comparable form of a normalized value — order matters (a reordered npc list
 * IS a change the DM made), and the entry objects are built here, so their key
 * order is fixed.
 */
function valueKey(value: FieldValue): string {
  switch (value.kind) {
    case "text":
      return `text:${value.text}`;
    case "list":
      return `list:${JSON.stringify(value.items)}`;
    case "pairs":
      return `pairs:${JSON.stringify(value.entries)}`;
  }
}

/**
 * A quickstat value keeps its YAML type: a value that is exactly how a number
 * prints stays a NUMBER, everything else stays a string. Without this, editing
 * one stat would rewrite `{wis: 2}` as `{wis: '2'}` — and a DM-typed „+2"
 * (which YAML reads as 2) must stay the string „+2" it was typed as.
 */
function pairScalar(value: string): string | number {
  const parsed = Number(value);
  return value !== "" && Number.isFinite(parsed) && String(parsed) === value ? parsed : value;
}

/** The YAML value a non-empty field writes. */
function patchValue(value: FieldValue): unknown {
  switch (value.kind) {
    case "text":
      return value.text;
    case "list":
      return [...value.items];
    case "pairs": {
      const out: Record<string, string | number> = {};
      for (const entry of value.entries) out[entry.key] = pairScalar(entry.value);
      return out;
    }
  }
}

/**
 * The PATCH /frontmatter patch: ONLY the fields whose value actually moved.
 * A field that ended up empty is sent as `null` (the server deletes the key),
 * everything else as its value. Keys the form does not know are never in here,
 * so a hand-edited file keeps them.
 */
export function frontmatterPatch(
  fields: readonly FrontmatterField[],
  initial: FormValues,
  current: FormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const before = initial[field.key];
    const after = current[field.key];
    if (before === undefined || after === undefined) continue;
    const from = normalize(before);
    const to = normalize(after);
    if (valueKey(from) === valueKey(to)) continue;
    patch[field.key] = isEmpty(to) ? null : patchValue(to);
  }
  return patch;
}

/**
 * What is WRONG in the form right now, per field key — the German line the
 * control shows under itself, and the reason „Speichern" stays disabled.
 *
 * Two controls can get into such a state.
 *
 * The pairs control, in both cases where writing (or not writing) silently
 * would lose something the DM typed:
 *
 *   * a row with a value but no name — it cannot be written at all, so it is
 *     said out loud instead of vanishing on save,
 *   * two rows with the SAME name — YAML has one key per name, so the earlier
 *     value would be swallowed by the later one.
 *
 * A row that is completely empty (or holds only a name, which means „delete
 * this key") is fine and produces nothing here.
 *
 * And an ID LIST (`npcs`, issue #70 audit): that list holds ids, not names —
 * every entry becomes a card and a reference the save creates — so the server
 * refuses a non-slug entry with a 400. Saying it here makes that a line under
 * the field before the click. `initial` is what the file already holds and is
 * EXEMPT: a campaign migrated from the file era may carry free text there, and
 * such a scene has to stay savable (the server exempts the same values).
 */
export function frontmatterFormIssues(
  fields: readonly FrontmatterField[],
  values: FormValues,
  initial?: FormValues,
): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.control === "references" && value.kind === "list") {
      const stored = initial?.[field.key];
      const known = stored !== undefined && stored.kind === "list" ? stored.items : [];
      const offender = value.items.find(
        (item) => !known.includes(item) && !isEntityId(item),
      );
      if (offender !== undefined) {
        issues[field.key] =
          `„${offender}" ist keine id — nur Kleinbuchstaben, Ziffern und Bindestriche.`;
      }
      continue;
    }
    if (value.kind !== "pairs") continue;
    const seen = new Set<string>();
    let nameless = false;
    let duplicate: string | undefined;
    for (const entry of value.entries) {
      const key = entry.key.trim();
      if (key === "") {
        if (entry.value.trim() !== "") nameless = true;
        continue;
      }
      if (seen.has(key)) duplicate ??= key;
      seen.add(key);
    }
    if (nameless) {
      issues[field.key] = "Zeile ohne Namen — Name ergänzen oder Zeile entfernen.";
    } else if (duplicate !== undefined) {
      issues[field.key] = `Name „${duplicate}" doppelt — jeder Name darf nur einmal vorkommen.`;
    }
  }
  return issues;
}

/**
 * True when the open form holds something a save would carry — the question
 * the discard guard asks. An unfinished pairs row counts: it is exactly the
 * work that must not disappear on a stray Esc.
 */
export function hasFrontmatterChanges(
  fields: readonly FrontmatterField[],
  initial: FormValues,
  current: FormValues,
): boolean {
  if (Object.keys(frontmatterPatch(fields, initial, current)).length > 0) return true;
  // With `initial`, so that free text a MIGRATED file already carries in
  // `npcs` is not read as unsaved work by the discard guard.
  return Object.keys(frontmatterFormIssues(fields, current, initial)).length > 0;
}

/** Blank required field = not a save (the entity would lose its name). */
export function canSubmitFrontmatter(
  fields: readonly FrontmatterField[],
  values: FormValues,
): boolean {
  for (const field of fields) {
    if (field.required !== true) continue;
    const value = values[field.key];
    if (value === undefined || value.kind !== "text" || value.text.trim() === "") return false;
  }
  return true;
}

/**
 * Fold the text still standing in a chip input into its list — the „typed a
 * tag and clicked Speichern straight away" case. The pending text lives in the
 * dialog (not inside the control) exactly so this can happen before the patch
 * is computed instead of being lost with the closing dialog.
 */
export function commitPendingText(
  fields: readonly FrontmatterField[],
  values: FormValues,
  pending: Record<string, string>,
): FormValues {
  let out = values;
  for (const field of fields) {
    if (fieldValueKind(field.control) !== "list") continue;
    const text = (pending[field.key] ?? "").trim();
    if (text === "") continue;
    const value = out[field.key];
    if (value === undefined || value.kind !== "list") continue;
    if (value.items.includes(text)) continue;
    out = { ...out, [field.key]: { kind: "list", items: [...value.items, text] } };
  }
  return out;
}

// --- reference lookups -------------------------------------------------------

/**
 * What a reference field offers: the ids that HAVE a file, labelled with their
 * name/title. Order is the tree's. A value outside this list is still valid —
 * the control is an input, not a closed list (README: references degrade).
 */
export function referenceOptions(
  tree: CampaignTree | undefined,
  source: ReferenceSource,
): FieldOption[] {
  if (tree === undefined) return [];
  switch (source) {
    case "npcs":
      return tree.npcs.map((npc) => ({ value: npc.id, label: npc.name }));
    case "locations":
      return tree.locations.map((location) => ({ value: location.id, label: location.name }));
    case "chapters":
      return tree.chapters.map((chapter) => ({ value: chapter.id, label: chapter.title }));
  }
}

/** The known name of an id, or undefined — the dim second line of a chip. */
export function referenceLabel(
  options: readonly FieldOption[],
  value: string,
): string | undefined {
  const hit = options.find((option) => option.value === value);
  return hit === undefined || hit.label === value ? undefined : hit.label;
}

/**
 * The options a select shows: the known set, plus any unknown value the field
 * holds — the one the FILE came with (`initial`) first. The format degrades —
 * a hand-written `status: onhold` must be visible and survive an unrelated
 * save, not be silently corrected to the first known option.
 *
 * Seeding from `initial` and not only from `current` is what makes it
 * RECOVERABLE: a DM who clicks through the list once must be able to put the
 * file's own value back, which a select cannot offer once it has dropped it.
 */
export function selectOptions(
  options: readonly FieldOption[],
  current: string,
  /** The value the dialog opened with; defaults to `current` (no history). */
  initial: string = current,
): readonly FieldOption[] {
  const extras: FieldOption[] = [];
  for (const raw of [initial, current]) {
    const value = raw.trim();
    if (value === "") continue;
    if (options.some((option) => option.value === value)) continue;
    if (extras.some((option) => option.value === value)) continue;
    extras.push({ value, label: value });
  }
  return extras.length === 0 ? options : [...options, ...extras];
}

// --- the write ---------------------------------------------------------------

/**
 * Save the patch. The 409 handling — nothing was written, the file is re-read
 * once so the next „Speichern" carries the fresh mtime — is the shared
 * protocol of write-with-mtime.ts. Every other failure throws.
 */
export function writeFrontmatterForm(
  campaign: string,
  path: string,
  mtimeMs: number,
  patch: Record<string, unknown>,
): Promise<MtimeWriteResult> {
  return writeWithMtime(
    () => patchFrontmatter(campaign, { path, mtimeMs, patch }),
    () => fetchFile(campaign, path),
  );
}
