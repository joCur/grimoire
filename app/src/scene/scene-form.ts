// The form of a scene — what its dialog and the editor of a proposed scene
// start with, and the write a save sends. Pure, so every rule is
// unit-testable.
//
// Only what the DM CHANGED is written: a field nobody touched keeps its
// stored value, whitespace around a value is no change, and a text field
// left blank clears the value (`null`) instead of writing an empty one. A
// scene always has a title, a type, a chapter and a status, so a blank title
// is no save, a blank chapter blocks the save with its own line, and type and
// status are chosen from their closed lists (decisions/constraints). The three lists hold
// what the chips show, trimmed and without blanks, in their order.
//
// Two fields take text that is not what they store:
//
//   location  the DM types a NAME; the scene stores the id it slugs to, so
//             nobody has to spell slugs. Text no slug can be derived from
//             (punctuation only) blocks the save: an id is never invented out
//             of nothing (shared/slug.ts).
//   npcs      the list holds ids, not names — a new entry that is no id can
//             name nothing, and the server refuses it. What the scene already
//             holds is exempt, so a scene stays savable whatever it carries.
//
// Whether a chapter, a location or an npc the form names EXISTS is the
// server's answer (a 400 with its own sentence, i18n/server-errors.ts).

import { isEntityId, toSlug } from "@grimoire/shared/slug";
import type { SceneChange, SceneProposal, SceneStatus, SceneType } from "@grimoire/shared/scene";

import type { FieldOption } from "@/components/fields/SelectField";
import { textValue } from "@/components/fields/text";
import type { Translate } from "@/i18n/format";

/** The scene's fields that hold a list, edited as chips. */
export type SceneListKey = "npcs" | "handouts" | "tags";

/** The scene's fields that are edited as text. */
type TextKey = Exclude<keyof SceneProposal, "id" | "body" | "type" | "status" | SceneListKey>;

/**
 * The form's values — typed against the scene, so a field the form does not
 * handle does not compile. `id` is fixed at creation (decisions/constraints) and `body` has
 * its own editor.
 */
export type SceneFormValues = { [K in TextKey]-?: string } & {
  type: SceneType;
  status: SceneStatus;
} & { [K in SceneListKey]: readonly string[] };

const TEXT_FIELDS = {
  title: true,
  trigger: true,
  chapter: true,
  location: true,
} satisfies Record<TextKey, true>;

const TEXT_KEYS = Object.keys(TEXT_FIELDS) as TextKey[];

const LIST_FIELDS = {
  npcs: true,
  handouts: true,
  tags: true,
} satisfies Record<SceneListKey, true>;

export const SCENE_LIST_KEYS = Object.keys(LIST_FIELDS) as SceneListKey[];

/** The text still standing in each chip input — a save folds it in. */
export type ScenePendingChips = Partial<Record<SceneListKey, string>>;

/** What the form starts with — the scene's current values. */
export function sceneFormValues(scene: SceneProposal): SceneFormValues {
  return {
    title: scene.title,
    type: scene.type,
    trigger: scene.trigger ?? "",
    chapter: scene.chapter,
    location: scene.location ?? "",
    npcs: scene.npcs,
    handouts: scene.handouts,
    tags: scene.tags,
    status: scene.status,
  };
}

// --- the location field: free text in, a slug out ------------------------------

/** The id the typed text stands for — "" when nothing usable is left. */
export function locationRefId(text: string): string {
  const typed = text.trim();
  if (typed === "") return "";
  return isEntityId(typed) ? typed : toSlug(typed);
}

/** What the location field's text means right now — its note, and the one issue. */
export type LocationRef =
  /** Nothing typed: the scene names no location. */
  | { kind: "empty" }
  /** A location that exists; `name` is its name, absent when it has none. */
  | { kind: "known"; id: string; name?: string }
  /** No location has this id — the save will be refused until one does. */
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
  // A label that equals the id is no name (a location nobody named is listed
  // under its own id), so it is not worth a line under the field.
  return { kind: "known", id, name: hit.label === id ? undefined : hit.label };
}

// --- the write ------------------------------------------------------------------

/** A list as it is compared and written: trimmed entries, blanks dropped, order kept. */
function listValue(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/**
 * Fold the text still standing in a chip input into its list — the case of a
 * tag typed and saved straight away. A blank or a duplicate entry changes
 * nothing.
 */
export function withPendingChips(
  values: SceneFormValues,
  pending: ScenePendingChips,
): SceneFormValues {
  let out = values;
  for (const key of SCENE_LIST_KEYS) {
    const text = (pending[key] ?? "").trim();
    if (text === "" || out[key].includes(text)) continue;
    out = { ...out, [key]: [...out[key], text] };
  }
  return out;
}

/**
 * The form as the scene's write: every field named, each with the value it
 * writes — a blank title and a blank chapter are left out, because a scene
 * cannot lose either, and so is location text that yields no id.
 */
function written(values: SceneFormValues): SceneChange {
  const change: SceneChange = {
    type: values.type,
    trigger: textValue(values.trigger),
    npcs: listValue(values.npcs),
    handouts: listValue(values.handouts),
    tags: listValue(values.tags),
    status: values.status,
  };
  const title = textValue(values.title);
  if (title !== null) change.title = title;
  const chapter = textValue(values.chapter);
  if (chapter !== null) change.chapter = chapter;
  if (values.location.trim() === "") change.location = null;
  else if (locationRefId(values.location) !== "") change.location = locationRefId(values.location);
  return change;
}

/** One field's value as it is compared: what it writes. */
function comparable(values: SceneFormValues, key: keyof SceneFormValues): string {
  switch (key) {
    case "location":
      return locationRefId(values.location);
    case "type":
    case "status":
      return values[key];
    case "npcs":
    case "handouts":
    case "tags":
      return JSON.stringify(listValue(values[key]));
    default:
      return values[key].trim();
  }
}

const FORM_KEYS: Array<keyof SceneFormValues> = [
  ...TEXT_KEYS,
  "type",
  "status",
  ...SCENE_LIST_KEYS,
];

/** The fields whose written value moved. */
function moved(initial: SceneFormValues, values: SceneFormValues): Array<keyof SceneFormValues> {
  return FORM_KEYS.filter((key) => comparable(initial, key) !== comparable(values, key));
}

/** The write of a save: ONLY the fields that moved and can be written. */
export function sceneFormChange(initial: SceneFormValues, values: SceneFormValues): SceneChange {
  const all = written(values);
  const change: SceneChange = {};
  for (const key of moved(initial, values)) {
    if (all[key] !== undefined) Object.assign(change, { [key]: all[key] });
  }
  return change;
}

/**
 * The form of a PROPOSED scene as the change the generator review keeps on
 * its job: every field named, so the change says what the form shows — a
 * value where the form holds one, `null` where `trigger` or `location` was
 * emptied.
 */
export function sceneProposalChange(values: SceneFormValues): SceneChange {
  return written(values);
}

/**
 * What blocks the save, per field — the line under the field. `initial` is
 * what the scene holds now: its `npcs` are exempt from the id rule.
 */
export function sceneFormIssues(
  values: SceneFormValues,
  initial: SceneFormValues | undefined,
  t: Translate,
): Partial<Record<keyof SceneFormValues, string>> {
  const issues: Partial<Record<keyof SceneFormValues, string>> = {};
  if (values.chapter.trim() === "") issues.chapter = t("properties.issue.chapterRequired");
  const location = locationRef(values.location, []);
  if (location.kind === "unusable") {
    issues.location = t("properties.issue.locationUnusable", { value: location.value });
  }
  const known = initial?.npcs ?? [];
  const offender = listValue(values.npcs).find((item) => !known.includes(item) && !isEntityId(item));
  if (offender !== undefined) issues.npcs = t("properties.issue.notAnId", { id: offender });
  return issues;
}

/**
 * Is there typed work a close would lose? A field that blocks the save
 * counts: it is exactly the work that must not disappear on a stray Esc.
 */
export function sceneFormDirty(
  initial: SceneFormValues,
  values: SceneFormValues,
  t: Translate,
): boolean {
  return (
    moved(initial, values).length > 0 ||
    Object.keys(sceneFormIssues(values, initial, t)).length > 0
  );
}

/** A blank title is not a save — the scene would lose its name. */
export function canSubmitSceneForm(
  initial: SceneFormValues,
  values: SceneFormValues,
  t: Translate,
): boolean {
  return (
    textValue(values.title) !== null &&
    Object.keys(sceneFormIssues(values, initial, t)).length === 0
  );
}
