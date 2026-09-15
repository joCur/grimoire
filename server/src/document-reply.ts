// The DOCUMENT reply (issue #107, PO decision of 15.09.): ONE JSON object per
// kind, mirroring the object the database stores.
//
//     { "properties": { "id": "night-watch-quay", "title": "Nachtwache am Kai",
//                       "type": "planned", "status": "draft", … },
//       "body": "## Flow\n\nDie Wache murrt: „Wer nachts hier steht …“\n",
//       "warnings": ["Der Quelltext nennt keinen DC — DC 13 gesetzt."] }
//
// Two earlier shapes are gone, and the reasons are worth keeping:
//
//   the JSON WRAPPER around a whole markdown file — the PO case of 15.09.:
//       the model hand-wrote the escaping of a complete document and a German
//       quotation mark closed with an ASCII `"` ended the string. A correct
//       scene, unparseable.
//   the RAW document — this branch's first answer to that. It removed the
//       escaping but put FRONTMATTER PARSING in its place, and that half
//       could not be forced by any API: a fence, a leading sentence, a
//       sign-off, two horizontal rules that look like a properties block. All
//       of it had to be tolerated by hand here, and a miss was a correction
//       turn or silent data loss.
//
// The object is forced by the provider for every document call now — Claude
// gets the schema as a tool with `tool_choice`, an OpenAI-compatible endpoint
// gets `response_format: json_schema` with `strict: true` (llm-provider.ts) —
// so the shape the API guarantees is the shape this module reads. The body
// travels as a JSON string, which the TRANSPORT escapes: quotation marks,
// newlines and backslashes survive because nobody hand-wrote them.
//
// What this module does NOT do is judge content. It reads the object,
// type-checks its `properties` against the kind's FIELD LIST
// (@grimoire/shared/property-fields — the very list the properties dialog is
// built from) and COMPOSES the document the server would store. Everything
// after that — a kebab `id`, a known scene type, references that resolve,
// known callouts, the npc format rules — stays in the validators
// (./generator.ts, ./generate-pipeline.ts, ./generator-augment.ts).

import { jsonrepair } from "jsonrepair";
import {
  PAIR_KEY,
  PAIR_VALUE,
  isNotGiven,
  propertyFieldsFor,
  type DocumentKind,
  type PropertyFieldDef,
} from "@grimoire/shared";
import { renderRaw } from "./store/render";

/** One document reply, normalized: the object the server stores plus notes. */
export interface DocumentReply {
  /**
   * The frontmatter mapping, in contract order, with „not given" (`null`)
   * dropped: strict mode has no optional properties, so the schema asks for
   * every field and `null` is how a model says it has nothing to put there.
   */
  properties: Record<string, unknown>;
  /** The markdown below the properties block, verbatim as it will be stored. */
  body: string;
  /** One note per entry; empty when there was nothing to report. */
  warnings: string[];
}

/**
 * The run warning a REPAIRED document reply earns — the sibling of
 * REPAIRED_REPLY_WARNING (generate-pipeline.ts), and there for the same
 * reason: the repair is silent otherwise, and a provider whose replies need
 * patching every single run is a provider to reconsider.
 */
export const REPAIRED_DOCUMENT_WARNING =
  "Antwort musste repariert werden — das Modell hat das Dokument nicht als " +
  "gültiges JSON-Objekt geliefert.";

/**
 * The error a reply that is not the reply object gets back — German, because
 * it travels into the (German) correction turn. It names the shape instead of
 * passing a verdict, and the correction turn adds the schema's name.
 */
export const NOT_A_DOCUMENT_ERROR =
  "die Antwort ist kein Objekt des Schemas — sie braucht genau die drei " +
  "Schlüssel `properties` (die Frontmatter-Felder), `body` (der Fließtext als " +
  "ein String) und `warnings` (eine Liste von Hinweisen). Kein Markdown-Dokument, " +
  "keine Code-Zäune, kein Text außerhalb des Objekts.";

/**
 * One raw reply as a JSON value — with ONE tolerant repair attempt before a
 * correction turn is spent. Shared by the document calls and the outline
 * (generate-pipeline `parseOutlineJson`).
 *
 * Three stages, first one that PARSES wins: the whole text (what a
 * schema-forced reply is), the content of a ```json fence, the span from the
 * first `{` to the last `}`. A candidate that merely LOOKS like an object is
 * then handed to `jsonrepair` once — a trailing comma or a single-quoted key
 * is mechanical, and much cheaper to fix than to re-ask for.
 *
 * `repaired` says which way in it was, so the run can say so too. The result
 * goes through the unchanged validation either way: the repair loosens the
 * parsing, never the rules.
 */
export function parseJsonReply(raw: string): { value: unknown; repaired: boolean } | null {
  for (const candidate of [raw, fenceContent(raw), braceSpan(raw)]) {
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
  const span = braceSpan(raw);
  if (span === null) return null;
  try {
    return { value: JSON.parse(jsonrepair(span)), repaired: true };
  } catch {
    return null;
  }
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

/** Substring from the first `{` to the last `}` — prose on both sides falls off. */
function braceSpan(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read one document reply: JSON in, the normalized object plus the COMPOSED
 * markdown out — or the error list for the correction turn.
 *
 * The markdown is the server's own rendering (`renderRaw`, the same one every
 * written file goes through), which is what makes the frontmatter block the
 * server's business again: `quickstats: { wis: "+2" }` is quoted because the
 * renderer quotes it, not because the model remembered to.
 */
export function parseDocumentReply(
  raw: string,
  kind: DocumentKind,
): { ok: true; reply: DocumentReply; markdown: string } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  if (parsed === null || !isRecord(parsed.value)) {
    return { ok: false, errors: [NOT_A_DOCUMENT_ERROR] };
  }
  const obj = parsed.value;
  const errors: string[] = [];

  if (!isRecord(obj.properties)) {
    return { ok: false, errors: [NOT_A_DOCUMENT_ERROR] };
  }
  const body = obj.body;
  if (typeof body !== "string") {
    errors.push('"body" muss der Fließtext als ein String sein');
  }
  const warnings = normalizeWarnings(obj.warnings, errors);
  const properties = normalizeProperties(kind, obj.properties, errors);
  if (errors.length > 0) return { ok: false, errors };

  const reply: DocumentReply = {
    properties,
    // The body is stored the way a file is: one trailing newline, and the
    // blank line the renderer puts between the block and the first heading.
    body: `${(body as string).replace(/^\n+/, "").trimEnd()}\n`,
    warnings: parsed.repaired ? [...warnings, REPAIRED_DOCUMENT_WARNING] : warnings,
  };
  return { ok: true, reply, markdown: composeDocument(reply) };
}

/** The document as it will be stored: the composed block plus the body. */
export function composeDocument(reply: DocumentReply): string {
  return renderRaw(reply.properties, `\n${reply.body}`);
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
  kind: DocumentKind,
  raw: Record<string, unknown>,
  errors: string[],
): Record<string, unknown> {
  const fields = propertyFieldsFor(kind) ?? [];
  const known = new Set(["id", ...fields.map((field) => field.key)]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      errors.push(
        `"properties.${key}" ist kein Feld dieser Entität — erlaubt sind: ` +
          `${[...known].join(", ")}`,
      );
    }
  }
  const out: Record<string, unknown> = {};
  const id = raw.id;
  if (typeof id === "string" && id.trim() !== "") out.id = id.trim();
  else if (!isNotGiven(id)) errors.push('"properties.id" muss ein String sein');

  for (const field of fields) {
    const value = fieldValue(field, raw[field.key], errors);
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}

/** One field's value, normalized — or undefined when the model gave none. */
function fieldValue(
  field: PropertyFieldDef,
  value: unknown,
  errors: string[],
): unknown {
  if (isNotGiven(value)) {
    if (field.required === true) {
      errors.push(`"properties.${field.key}" fehlt — das Feld ist verpflichtend`);
    }
    return undefined;
  }
  switch (field.control) {
    case "references":
    case "chips": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push(`"properties.${field.key}" muss eine Liste von Strings sein`);
        return undefined;
      }
      // An empty list is „not given": `tags: []` is noise in a file the DM
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
