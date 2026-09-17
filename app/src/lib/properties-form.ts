// „Eigenschaften" — editing ALL properties fields of one entry from the app.
// This module is the pure half: which fields a kind has, what the open form
// starts with, and the PATCH body a save sends.
// No react, no query imports, so every rule here is unit-testable.
//
// Three rules carry the whole thing:
//
//   1. The FIELD LIST comes from the entity types in @grimoire/shared — one
//      list per kind, `id` deliberately absent (it is fixed at creation,
//      ADR #21) and the kind itself as well (it is derived from the path).
//   2. Only what the DM CHANGED is patched. PATCH /properties re-emits the
//      whole YAML block from the parsed entry, so every key we do not send
//      keeps its value — unknown keys of an imported entry included. Sending
//      an unchanged field would be a no-op at best and a type/format change at
//      worst (`quickstats: {wis: 2}` -> `{wis: '2'}`).
//   3. Clearing a field DELETES the key (`null`, the server's delete marker)
//      instead of writing an empty value — `tags: []` or `role: ''` is noise
//      in an entry the DM also reads in an editor. Same choice the campaign
//      metadata dialog made for a blank description.
//
// The format DEGRADES (README): an unknown `status`/`type` value is offered as
// its own option instead of being corrected away, a reference field takes a
// free-text id that has no entry yet, and a wrong-typed value is shown as text
// rather than throwing.

import { type CampaignTree, type EntityKind } from "@grimoire/shared/types";
import {
  PROPERTY_FIELDS,
  isPropertiesKind,
  type FieldControl,
  type PropertiesKind,
  type PropertyFieldDef,
  type ReferenceSource,
} from "@grimoire/shared/property-fields";
import { toSlug } from "@grimoire/shared/slug";

import { fetchEntry, patchProperties } from "@/api";
import type { Translate } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages";
import { isEntityId, npcStatusLabel } from "@/lib/entity";
import { fmQuickstats, fmStringArray } from "@/lib/properties";
import { chapterStatusOptions } from "@/lib/chapter-status";
import { sceneStatusOptions } from "@/lib/scene-status";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

/**
 * How one field is edited:
 *
 *   text / textarea   free string (textarea = the fields that hold a sentence)
 *   select            a known value set, plus whatever stands in the entry
 *   reference         ONE id of an existing entity, free text allowed
 *   references        MANY such ids, as chips
 *   chips             free string list (`tags`, `handouts`)
 *   pairs             free key/value map (`quickstats`)
 *
 * The kinds, the controls and the reference sources come from
 * @grimoire/shared/property-fields — the generator's reply schemas are built
 * from the SAME field list, so „which fields does an npc have" is answered
 * once for the whole repo. Re-exported here because every caller in the app
 * already imports them from this module.
 */
export type { FieldControl, PropertiesKind, ReferenceSource };

export interface FieldOption {
  /** What is written to the entry. */
  value: string;
  /** What the DM reads — the entity's name/title, or the value itself. */
  label: string;
}

export interface PropertiesField {
  /** The properties key, verbatim (`roll20-page` included). */
  key: string;
  /** German label above the control. */
  label: string;
  control: FieldControl;
  /** Quiet German line under the control; the format's own note in most cases. */
  hint?: string;
  /** A field the entity cannot lose (`title`/`name`) — blank blocks the save. */
  required?: boolean;
  /**
   * A REFERENCE the entry cannot lose — a scene's chapter, which is part of
   * its address. Clearing it blocks the save with its own line under the
   * field (`propertiesFormIssues`) instead of travelling to the server and
   * coming back as a 400.
   *
   * Separate from `required`, which is about a field that holds a NAME and
   * also makes the key non-nullable in the generator's reply schema
   * (@grimoire/shared/entry-schema) — a generated scene may well carry no
   * chapter of its own, because the run writes it.
   */
  mandatoryRef?: boolean;
  placeholder?: string;
  /** `select` only: the known value set. */
  options?: readonly FieldOption[];
  /** `reference`/`references` only: which tree list to offer. */
  source?: ReferenceSource;
}

// --- the field tables ------------------------------------------------------
//
// Labels, hints and placeholders come from the CATALOG: the tables are built
// per call with the translator the dialog is rendered with, so a language
// switch changes them on the spot.
//
// Three kinds of string, three different owners:
//
//   field KEYS      `title`, `npcs`, `roll20-page` — wire names. They travel
//                   to the server and back and are never translated.
//   option VALUES   `active`, `planned`, `insight +2` — data. Not copy.
//   LABELS          the only translated half: every one of them is a catalog
//                   key here (FIELD_COPY), resolved through the translator.
//
// The enum option LABELS (scene status, npc status, chapter status) come from
// lib/scene-status.ts, lib/entity.ts and lib/chapter-status.ts instead, which
// the pool, the lists and the cards share: a signature change here would drag
// half of those views along.

/** Catalog keys of a field's copy — label, and the optional two below it. */
interface FieldCopy {
  label: MessageKey;
  hint?: MessageKey;
  placeholder?: MessageKey;
}

/**
 * The COPY of every field, by kind and key. This is the whole app-side half
 * of the tables: the field LIST, its order, its controls and its known value
 * sets live in @grimoire/shared/property-fields, and what is left here is
 * what a translator owns.
 *
 * The field KEYS (`title`, `npcs`, `roll20-page`) are wire names and stay
 * untranslated, and so do the option VALUES — `active`, `planned`,
 * `insight +2` are data. Only the LABELS are translated, and every one of
 * them is a catalog key here.
 */
const FIELD_COPY: Record<PropertiesKind, Record<string, FieldCopy>> = {
  scene: {
    title: { label: "properties.scene.title.label" },
    type: { label: "properties.scene.type.label" },
    trigger: { label: "properties.scene.trigger.label", hint: "properties.scene.trigger.hint" },
    chapter: { label: "properties.scene.chapter.label" },
    location: { label: "properties.scene.location.label", hint: "properties.scene.location.hint" },
    npcs: { label: "properties.scene.npcs.label", hint: "properties.scene.npcs.hint" },
    handouts: { label: "properties.scene.handouts.label", hint: "properties.scene.handouts.hint" },
    tags: { label: "properties.scene.tags.label", hint: "properties.scene.tags.hint" },
    status: { label: "properties.scene.status.label" },
  },
  npc: {
    name: { label: "properties.npc.name.label" },
    role: { label: "properties.npc.role.label", hint: "properties.npc.role.hint" },
    chapter: { label: "properties.npc.chapter.label", hint: "properties.npc.chapter.hint" },
    status: { label: "properties.npc.status.label" },
    statblock: {
      label: "properties.npc.statblock.label",
      hint: "properties.npc.statblock.hint",
      placeholder: "properties.npc.statblock.placeholder",
    },
    quickstats: { label: "properties.npc.quickstats.label", hint: "properties.npc.quickstats.hint" },
    voice: { label: "properties.npc.voice.label", hint: "properties.npc.voice.hint" },
    appearance: { label: "properties.npc.appearance.label", hint: "properties.npc.appearance.hint" },
  },
  location: {
    name: { label: "properties.location.name.label" },
    chapter: { label: "properties.location.chapter.label" },
    "roll20-page": { label: "properties.location.roll20.label", hint: "properties.location.roll20.hint" },
  },
  chapter: {
    title: { label: "properties.chapter.title.label" },
    // No placeholder: a select has no empty text box to hint at.
    status: { label: "properties.chapter.status.label", hint: "properties.chapter.status.hint" },
  },
};

const SCENE_TYPE_LABEL_KEYS: Record<string, MessageKey> = {
  planned: "properties.scene.type.planned",
  contingency: "properties.scene.type.contingency",
};

/**
 * The labelled options of a `select`. The enum LABELS come from the modules
 * the pool, the lists and the cards share (lib/scene-status.ts,
 * lib/entity.ts, lib/chapter-status.ts) — the VALUES come from the shared
 * field list, so a format change lands in one place and the labels follow.
 */
function optionsOf(
  kind: PropertiesKind,
  def: PropertyFieldDef,
  t: Translate,
): readonly FieldOption[] | undefined {
  if (def.control !== "select") return undefined;
  if (kind === "scene" && def.key === "status") return sceneStatusOptions(t);
  // The same three labels the overview's status control shows, so picking
  // „Aktiv" reads identically in both places. The server performs the swap to
  // the one active chapter for a properties patch too, so the rule does not
  // depend on which of the two doors the write came through.
  if (kind === "chapter" && def.key === "status") return chapterStatusOptions(t);
  if (kind === "npc" && def.key === "status") {
    return (def.values ?? []).map((value) => ({ value, label: npcStatusLabel(value, t) }));
  }
  if (kind === "scene" && def.key === "type") {
    return (def.values ?? []).map((value) => {
      const key = SCENE_TYPE_LABEL_KEYS[value];
      return { value, label: key === undefined ? value : t(key) };
    });
  }
  return (def.values ?? []).map((value) => ({ value, label: value }));
}

/** One shared field definition plus the copy the dialog renders it with. */
function fieldOf(kind: PropertiesKind, def: PropertyFieldDef, t: Translate): PropertiesField {
  const copy = FIELD_COPY[kind][def.key];
  const options = optionsOf(kind, def, t);
  return {
    key: def.key,
    control: def.control,
    // A field without copy would be a silent blank label; the key is the
    // honest fallback and the i18n test is what keeps it unused.
    label: copy === undefined ? def.key : t(copy.label),
    ...(def.required === true ? { required: true } : {}),
    // The scene is the one kind whose `chapter` is mandatory (ADR #19): an
    // npc and an Ort may sit outside every chapter, a scene may not — its
    // chapter is a segment of its address.
    ...(kind === "scene" && def.key === "chapter" ? { mandatoryRef: true } : {}),
    ...(def.source === undefined ? {} : { source: def.source }),
    ...(copy?.hint === undefined ? {} : { hint: t(copy.hint) }),
    ...(copy?.placeholder === undefined ? {} : { placeholder: t(copy.placeholder) }),
    ...(options === undefined ? {} : { options }),
  };
}

export function propertiesFieldsFor(
  kind: EntityKind,
  t: Translate,
): readonly PropertiesField[] | undefined {
  if (!isPropertiesKind(kind)) return undefined;
  return PROPERTY_FIELDS[kind].map((def) => fieldOf(kind, def, t));
}

/** German label of the kind for the dialog title („NPC-Eigenschaften"). */
export function propertiesKindLabel(kind: EntityKind, t: Translate): string | undefined {
  switch (kind) {
    case "scene":
      return t("kind.scene");
    case "npc":
      return t("kind.npc");
    case "location":
      return t("kind.location");
    case "chapter":
      return t("kind.chapter");
    default:
      return undefined;
  }
}

// --- the Ort field: free text in, a slug out ---------------------------------
//
// `location` IS the group a scene sits under in its chapter, so it holds an
// entity id — but the DM types a NAME, and the field takes it: „Der alte
// Hafen" is read as `der-alte-hafen`, so nobody has to spell slugs. What the
// hint then says is which entry that id means, and „Unbekannt" when no Ort
// has it: a reference names an entry that exists, so the save is refused
// until the Ort is there.
//
// Text no slug can be derived from („???") blocks the save in the form
// itself: an id is never invented out of nothing (shared/slug.ts), so there
// is nothing to send.

/** The id the typed text stands for — "" when nothing usable is left. */
export function locationRefId(text: string): string {
  const typed = text.trim();
  if (typed === "") return "";
  return isEntityId(typed) ? typed : toSlug(typed);
}

/** What the Ort field's text means right now — the hint, and the one issue. */
export type LocationRef =
  /** Nothing typed: the scene sits on chapter level. */
  | { kind: "empty" }
  /** An entry that exists; `name` is its name, absent when it has none. */
  | { kind: "known"; id: string; name?: string }
  /** No Ort has this id — the save will be refused until one does. */
  | { kind: "unknown"; id: string }
  /** Text that yields no id at all — the state the form itself blocks. */
  | { kind: "unusable"; value: string };

export function locationRef(text: string, options: readonly FieldOption[]): LocationRef {
  const typed = text.trim();
  if (typed === "") return { kind: "empty" };
  const id = locationRefId(typed);
  if (id === "") return { kind: "unusable", value: typed };
  const hit = options.find((option) => option.value === id);
  if (hit === undefined) return { kind: "unknown", id };
  // A label that equals the id is no name (referenceOptions labels a nameless
  // entry with its own id), so it is not worth a line under the field.
  return { kind: "known", id, name: hit.label === id ? undefined : hit.label };
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
 * A scalar properties value as editable text. Numbers and booleans are shown
 * verbatim instead of being dropped (degrade — a hand-edited `roll20-page: 12`
 * is text to the DM); anything structural becomes an empty field, and since an
 * untouched field is never patched, nothing is lost by that.
 */
function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** What the form starts with — the entry's current values, field by field. */
export function propertiesFormValues(
  fields: readonly PropertiesField[],
  properties: Record<string, unknown>,
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = properties[field.key];
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
function normalize(value: FieldValue, field?: PropertiesField): FieldValue {
  switch (value.kind) {
    case "text":
      // The Ort field is the one control whose normalized form is not the
      // typed text: it takes free text and STORES the slug, so slugging
      // here is what makes „Der Leuchtturm von
      // Salzhafen" over a stored `leuchtturm`… well, a different id — but
      // „leuchtturm " or a re-typed „der-alte-hafen" no change at all, and
      // it is the same value the patch writes.
      return field?.source === "locations" && field.control === "reference"
        ? { kind: "text", text: locationRefId(value.text) }
        : { kind: "text", text: value.text.trim() };
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
        // silently dropped, though: propertiesFormIssues blocks the save
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
 * The PATCH /properties patch: ONLY the fields whose value actually moved.
 * A field that ended up empty is sent as `null` (the server deletes the key),
 * everything else as its value. Keys the form does not know are never in here,
 * so an imported entry keeps them.
 */
export function propertiesPatch(
  fields: readonly PropertiesField[],
  initial: FormValues,
  current: FormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const before = initial[field.key];
    const after = current[field.key];
    if (before === undefined || after === undefined) continue;
    const from = normalize(before, field);
    const to = normalize(after, field);
    if (valueKey(from) === valueKey(to)) continue;
    // Text in the Ort field that yields NO id is not a cleared field: it
    // normalizes to "" (there is no slug), and sending `location: null` would
    // silently move the scene to chapter level instead of writing what the DM
    // typed. `propertiesFormIssues` blocks the save on it; the patch is empty
    // either way, so neither half can turn a typo into a move.
    if (
      field.source === "locations" &&
      field.control === "reference" &&
      after.kind === "text" &&
      after.text.trim() !== "" &&
      isEmpty(to)
    ) {
      continue;
    }
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
 * A `location` that yields NO id: the field takes free
 * text and the save slugs it, so „Der alte Hafen" is fine — but „???" leaves
 * nothing an id could be made of (shared/slug.ts never invents one), and
 * there is no value to send. The hint under the field says what every other
 * text WILL do; this is the one that cannot be done.
 *
 * And an ID LIST (`npcs`): that list holds ids, not names — every entry is a
 * reference to an npc entry — so a non-slug entry can name nothing and the
 * server refuses it. Saying it here makes that a line under the field before
 * the click. `initial` is what the entry already holds and is EXEMPT, so a
 * scene stays savable whatever it carries today.
 *
 * And a MANDATORY REFERENCE that was cleared: a scene's chapter is part of
 * its address, so the server refuses a patch that removes it
 * (`chapter_required`). Saying it here is the same improvement — a line under
 * the field and a disabled „Speichern", instead of a round trip that ends in
 * a toast.
 */
export function propertiesFormIssues(
  fields: readonly PropertiesField[],
  values: FormValues,
  initial: FormValues | undefined,
  t: Translate,
): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    // One field carries this flag — the scene's `chapter` — so the sentence
    // names it. A second mandatory reference would need its own.
    if (field.mandatoryRef === true && value.kind === "text" && value.text.trim() === "") {
      issues[field.key] = t("properties.issue.chapterRequired");
      continue;
    }
    if (field.source === "locations" && value.kind === "text") {
      const ref = locationRef(value.text, []);
      if (ref.kind === "unusable") {
        issues[field.key] = t("properties.issue.locationUnusable", { value: ref.value });
      }
      continue;
    }
    if (field.control === "references" && value.kind === "list") {
      const stored = initial?.[field.key];
      const known = stored !== undefined && stored.kind === "list" ? stored.items : [];
      const offender = value.items.find(
        (item) => !known.includes(item) && !isEntityId(item),
      );
      if (offender !== undefined) {
        issues[field.key] = t("properties.issue.notAnId", { id: offender });
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
      issues[field.key] = t("properties.issue.namelessRow");
    } else if (duplicate !== undefined) {
      issues[field.key] = t("properties.issue.duplicateName", { name: duplicate });
    }
  }
  return issues;
}

/**
 * True when the open form holds something a save would carry — the question
 * the discard guard asks. An unfinished pairs row counts: it is exactly the
 * work that must not disappear on a stray Esc.
 */
export function hasPropertiesChanges(
  fields: readonly PropertiesField[],
  initial: FormValues,
  current: FormValues,
  t: Translate,
): boolean {
  if (Object.keys(propertiesPatch(fields, initial, current)).length > 0) return true;
  // With `initial`, so that free text an imported entry already carries in
  // `npcs` is not read as unsaved work by the discard guard.
  return Object.keys(propertiesFormIssues(fields, current, initial, t)).length > 0;
}

/** Blank required field = not a save (the entity would lose its name). */
export function canSubmitProperties(
  fields: readonly PropertiesField[],
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
  fields: readonly PropertiesField[],
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
 * What a reference field offers: the ids that HAVE an entry, labelled with their
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
 * entry's own value back, which a select cannot offer once it has dropped it.
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
 * Save the patch. The 409 handling — nothing was written, the entry is re-read
 * once so the next „Speichern" carries the fresh rev — is the shared
 * protocol of write-with-rev.ts. Every other failure throws.
 */
export function writePropertiesForm(
  campaign: string,
  path: string,
  rev: number,
  patch: Record<string, unknown>,
): Promise<RevWriteResult> {
  return writeWithRev(
    () => patchProperties(campaign, { path, rev, patch }),
    () => fetchEntry(campaign, path),
  );
}
