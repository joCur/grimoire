// The ENTRY reply: ONE JSON object per kind, mirroring the entry the
// database stores.
//
//     { "properties": { "id": "night-watch-quay", "title": "Nachtwache am Kai",
//                       "type": "planned", "status": "draft", … },
//       "body": "## Flow\n\nDie Wache murrt: „Wer nachts hier steht …“\n",
//       "warnings": ["Der Quelltext nennt keinen DC — DC 13 gesetzt."] }
//
// Two shapes it is deliberately NOT, and the reasons are worth keeping:
//
//   a JSON WRAPPER the model fills with a whole rendered entry: it would
//       hand-write the escaping of that entry, and a German quotation mark
//       closed with an ASCII `"` ends the string. A correct scene,
//       unparseable.
//   the RENDERED ENTRY as one markdown text: that removes the escaping but
//       puts TEXT PARSING in its place, and that half cannot be forced by any
//       API — a fence, a leading sentence, a sign-off, two horizontal rules
//       that look like a properties block. All of it would have to be
//       tolerated by hand here, and a miss is a correction turn or silent
//       data loss.
//
// The object is forced by the provider for every entry call now — Claude
// gets the schema as a tool with `tool_choice`, an OpenAI-compatible endpoint
// gets `response_format: json_schema` with `strict: true` (llm-provider.ts) —
// so the shape the API guarantees is the shape this module reads. The body
// travels as a JSON string, which the TRANSPORT escapes: quotation marks,
// newlines and backslashes survive because nobody hand-wrote them.
//
// What this module does NOT do is judge content. It reads the object,
// type-checks its `properties` against the kind's FIELD LIST
// (@grimoire/shared/property-fields — the very list the properties dialog is
// built from) and hands on the properties/body pair the store speaks.
// Everything after that — a kebab `id`, a known scene type, references that
// resolve, known callouts, the npc format rules — stays in the validators
// (./generator.ts, ./generate-pipeline.ts, ./generator-augment.ts).

import { jsonrepair } from "jsonrepair";
import {
  PAIR_KEY,
  PAIR_VALUE,
  isNotGiven,
  propertyFieldsFor,
  type EntryKind,
  type EntryMode,
  type PropertyFieldDef,
} from "@grimoire/shared";

/** One entry reply, normalized: the object the server stores plus notes. */
export interface EntryReply {
  /**
   * The properties mapping, in contract order, with „not given" (`null`)
   * dropped: strict mode has no optional properties, so the schema asks for
   * every field and `null` is how a model says it has nothing to put there.
   */
  properties: Record<string, unknown>;
  /** The markdown body, verbatim as it will be stored. */
  body: string;
  /** One note per entry; empty when there was nothing to report. */
  warnings: string[];
  /**
   * The property keys the reply carried that the kind does NOT have — empty
   * except in `augment` mode, which drops them instead of failing the run
   * (see `normalizeProperties`). A validator that has a rule about such a key
   * — a location must never carry a `status` — reads it here; everything else
   * ignores it, which is the point. Optional, so a reply built in a test or a
   * fixture does not have to carry an empty list.
   */
  ignored?: string[];
}

/**
 * The run warning a REPAIRED entry reply earns — the sibling of
 * REPAIRED_REPLY_WARNING (generate-pipeline.ts), and there for the same
 * reason: the repair is silent otherwise, and a provider whose replies need
 * patching every single run is a provider to reconsider.
 */
export const REPAIRED_ENTRY_WARNING =
  "Antwort musste repariert werden — das Modell hat den Eintrag nicht als " +
  "gültiges JSON-Objekt geliefert.";

/**
 * The error a reply that is not the reply object gets back — German, because
 * it travels into the (German) correction turn. It names the shape instead of
 * passing a verdict, and the correction turn adds the schema's name.
 */
export const NOT_AN_ENTRY_ERROR =
  "die Antwort ist kein Objekt des Schemas — sie braucht genau die drei " +
  "Schlüssel `properties` (die Eigenschaften), `body` (der Fließtext als " +
  "ein String) und `warnings` (eine Liste von Hinweisen). Gib genau dieses " +
  "Objekt zurück — als ganze Antwort, ohne Code-Zäune.";

/**
 * One raw reply as a JSON value — with ONE tolerant repair attempt before a
 * correction turn is spent. Shared by the entry calls and the outline
 * (generate-pipeline `parseOutlineJson`).
 *
 * Three stages, first one that PARSES wins: the whole text (what a
 * schema-forced reply is), the content of a ```json fence, and the brace
 * SPANS — from the first `{` to a closing brace, the last one first and then
 * progressively earlier ones. The walk back matters because a reply may carry
 * prose that itself contains a `}` („… wie `{ "a": 1 }` oben"): one span to
 * the very last brace would then never parse and every stage would fail on a
 * entry that is perfectly readable a few characters earlier. A candidate
 * that merely LOOKS like an object is then handed to `jsonrepair` once — a
 * trailing comma or a single-quoted key is mechanical, and much cheaper to fix
 * than to re-ask for.
 *
 * `repaired` says which way in it was, so the run can say so too. The result
 * goes through the unchanged validation either way: the repair loosens the
 * parsing, never the rules.
 */
export function parseJsonReply(raw: string): { value: unknown; repaired: boolean } | null {
  const spans = braceSpans(raw);
  for (const candidate of [raw, fenceContent(raw), ...spans]) {
    if (candidate === null) continue;
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    try {
      return { value: JSON.parse(trimmed), repaired: false };
    } catch {
      // next stage
    }
  }
  // Prose without an object is NOT repaired: jsonrepair would happily turn a
  // sentence into a JSON string, and the run would then fail with a message
  // about the wrong thing.
  for (const span of spans) {
    try {
      const value: unknown = JSON.parse(jsonrepair(span));
      // A span STARTS with `{`, so a repair that produced anything else
      // invented structure rather than fixing a comma: `{"a":1} Fertig, ja.`
      // repairs into a three-element ARRAY, and a run that accepted that
      // would fail with a message about the wrong thing. The next (earlier)
      // span is the one that is actually meant.
      if (isRecord(value)) return { value, repaired: true };
    } catch {
      // next span
    }
  }
  return null;
}

/** ```json fence (labelled wins) or a bare ``` fence — the FIRST of the reply. */
const LABELLED_FENCE = /```json\b[ \t]*\r?\n?([\s\S]*?)```/i;
const BARE_FENCE = /```[ \t]*\r?\n([\s\S]*?)```/;

function fenceContent(raw: string): string | null {
  const labelled = LABELLED_FENCE.exec(raw);
  if (labelled !== null) return labelled[1]!;
  const bare = BARE_FENCE.exec(raw);
  return bare === null ? null : bare[1]!;
}

/** How many closing braces the span walk tries before it gives up. */
const BRACE_SPAN_ATTEMPTS = 5;

/**
 * The spans from the first `{` to a closing brace, the LAST one first and
 * then progressively earlier ones — bounded, so a body full of braces cannot
 * turn one reply into a quadratic parse. Prose on both sides falls off.
 */
function braceSpans(raw: string): string[] {
  const start = raw.indexOf("{");
  if (start === -1) return [];
  const spans: string[] = [];
  let end = raw.lastIndexOf("}");
  while (end > start && spans.length < BRACE_SPAN_ATTEMPTS) {
    spans.push(raw.slice(start, end + 1));
    end = raw.lastIndexOf("}", end - 1);
  }
  return spans;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read one entry reply: JSON in, the normalized `{ properties, body }` pair
 * plus the warnings out — or the error list for the correction turn.
 *
 * Nothing is rendered on the way: the pair travels through the validators
 * and into the store as the two halves it is, so a value the model wrote
 * (`quickstats: { wis: "+2" }`) reaches the row exactly as it was read.
 */
export function parseEntryReply(
  raw: string,
  kind: EntryKind,
  mode: EntryMode = "create",
): { ok: true; reply: EntryReply } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  if (parsed === null || !isRecord(parsed.value)) {
    return { ok: false, errors: [NOT_AN_ENTRY_ERROR] };
  }
  const obj = parsed.value;
  const errors: string[] = [];

  if (!isRecord(obj.properties)) {
    return { ok: false, errors: [NOT_AN_ENTRY_ERROR] };
  }
  const body = obj.body;
  if (typeof body !== "string") {
    errors.push('"body" muss der Fließtext als ein String sein');
  }
  const warnings = normalizeWarnings(obj.warnings, errors);
  const read = normalizeProperties(kind, mode, obj.properties, errors);
  if (errors.length > 0) return { ok: false, errors };

  const reply: EntryReply = {
    properties: read.properties,
    ignored: read.ignored,
    // The body is stored the way the store keeps it: no leading blank lines
    // and exactly one trailing newline.
    body: `${(body as string).replace(/^\n+/, "").trimEnd()}\n`,
    warnings: parsed.repaired ? [...warnings, REPAIRED_ENTRY_WARNING] : warnings,
  };
  return { ok: true, reply };
}

function normalizeWarnings(value: unknown, errors: string[]): string[] {
  if (isNotGiven(value)) return [];
  if (!Array.isArray(value)) {
    errors.push('"warnings" muss eine Liste von Strings sein');
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push('"warnings" muss eine Liste von Strings sein');
      return [];
    }
    if (item.trim() !== "") out.push(item.trim());
  }
  return out;
}

/**
 * The `properties` half, field by field: only keys the kind HAS, each value
 * in the shape its field describes, `null` read as „not given" and dropped.
 * Order is the field list's, so two replies of one kind compose to the same
 * block layout.
 *
 * `id` is passed through as a string without further judgement — its kebab
 * rule is semantic and is checked where it always was, by the validator that
 * also knows whether the id may be a NEW one.
 */
function normalizeProperties(
  kind: EntryKind,
  mode: EntryMode,
  raw: Record<string, unknown>,
  errors: string[],
): { properties: Record<string, unknown>; ignored: string[] } {
  const fields = propertyFieldsFor(kind) ?? [];
  const known = new Set(["id", ...fields.map((field) => field.key)]);
  // An unknown key is an error in a CREATE run — the entry is new, so the
  // only way a key the kind does not have gets here is an endpoint that
  // ignored the schema, and naming it is the correction turn's job.
  //
  // In an AUGMENT run it is not: the entry EXISTS, so the key may be one the
  // DM hand-wrote (`roll20-page` on an npc, app bookkeeping) that the model
  // simply echoed back from the entry it was shown. The schema cannot let it
  // PROPOSE such a key, and dropping it here loses nothing — the proposal
  // patches only the keys it lists, and every other key keeps its value.
  // Failing the whole reply over an echo would make a run impossible for a
  // entry the DM is free to author that way.
  const ignored: string[] = [];
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue;
    if (mode === "create") {
      errors.push(
        `"properties.${key}" ist kein Feld dieser Entität — erlaubt sind: ` +
          `${[...known].join(", ")}`,
      );
    } else {
      ignored.push(key);
    }
  }
  const out: Record<string, unknown> = {};
  const id = raw.id;
  if (typeof id === "string" && id.trim() !== "") out.id = id.trim();
  else if (!isNotGiven(id)) errors.push('"properties.id" muss ein String sein');

  const defaults = PROPERTY_DEFAULTS[kind] ?? {};
  for (const field of fields) {
    const before = errors.length;
    const read = fieldValue(field, raw[field.key], errors);
    const value = read ?? defaults[field.key];
    // „Verpflichtend" is checked HERE, after the value was normalized: a
    // required field whose value is whitespace only (`name: "   "`) trims to
    // the empty string, and dropping that silently is how an npc ends up
    // named after its id. A field whose SHAPE was already complained about
    // (`title: 7`) is not reported twice.
    if (value === undefined && field.required === true && errors.length === before) {
      errors.push(`"properties.${field.key}" fehlt — das Feld ist verpflichtend`);
    }
    if (value !== undefined) out[field.key] = value;
  }
  return { properties: out, ignored };
}

/**
 * The value a nullable field falls back to when the reply says „not given" —
 * the SAME default the renderer applies for an empty column
 * (store/render.ts: a scene is `planned`, an npc `unknown`), spelled out in
 * the properties instead of left to every reader.
 *
 * The two fields exist because the schema and the validators disagreed
 * otherwise: strict mode has no optional properties, so a field the prompt
 * declares optional („nicht gegeben → null") is NULLABLE — and the
 * validators, written against the pre-cutover format where the parser filled
 * these in, reject an absent scene `type` / npc `status` outright. The
 * default is the pre-cutover behaviour, restored where the key is composed.
 */
const PROPERTY_DEFAULTS: Partial<Record<EntryKind, Record<string, string>>> = {
  // "planned" is the unmarked case; a contingency scene says so explicitly.
  scene: { type: "planned" },
  // "unknown" is what a status-less npc means — never "alive", which would be
  // the run asserting something about a figure the source text is silent on.
  npc: { status: "unknown" },
};

/** One field's value, normalized — or undefined when the model gave none. */
function fieldValue(
  field: PropertyFieldDef,
  value: unknown,
  errors: string[],
): unknown {
  // „not given" and „given but empty" are one case here; whether the field
  // may be missing is decided by the caller (see normalizeProperties).
  if (isNotGiven(value)) return undefined;
  switch (field.control) {
    case "references":
    case "chips": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push(`"properties.${field.key}" muss eine Liste von Strings sein`);
        return undefined;
      }
      // An empty list is „not given": `tags: []` is noise in an entry the DM
      // also reads in an editor (the properties dialog's own rule).
      const items = (value as string[]).map((item) => item.trim()).filter((item) => item !== "");
      return items.length === 0 ? undefined : items;
    }
    case "pairs":
      return pairsValue(field, value, errors);
    default: {
      if (typeof value !== "string") {
        errors.push(`"properties.${field.key}" muss ein String sein`);
        return undefined;
      }
      const text = value.trim();
      return text === "" ? undefined : text;
    }
  }
}

/**
 * A `pairs` field (`quickstats`) arrives as a LIST of `{ key, value }`
 * objects and is folded back into the mapping the format contract asks for.
 *
 * The detour exists because strict mode cannot express a free key/value map
 * at all (`additionalProperties` must be `false`), and the alternative — a
 * fixed set of stat keys — would be the schema deciding which ability scores
 * a campaign may care about.
 */
function pairsValue(field: PropertyFieldDef, value: unknown, errors: string[]): unknown {
  const shape = `"properties.${field.key}" muss eine Liste von { ${PAIR_KEY}, ${PAIR_VALUE} } sein`;
  if (!Array.isArray(value)) {
    errors.push(shape);
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const item of value) {
    if (!isRecord(item)) {
      errors.push(shape);
      return undefined;
    }
    const key = item[PAIR_KEY];
    const text = item[PAIR_VALUE];
    if (typeof key !== "string" || typeof text !== "string") {
      errors.push(shape);
      return undefined;
    }
    if (key.trim() === "") continue;
    out[key.trim()] = text.trim();
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
