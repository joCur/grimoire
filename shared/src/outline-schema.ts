// The JSON schema of the generator's OUTLINE reply (issue #107, Zuschnitt 2).
//
// The outline is the one call of a run that still answers JSON — it is a
// small, flat object (which scenes exist, what they are called, which ids the
// run introduces), and that is the shape a structured-output API can
// GUARANTEE. Since this ticket both providers do exactly that: the Claude
// provider sends the schema as a tool and forces the call, an
// OpenAI-compatible endpoint sends it as `response_format: json_schema`
// (server/src/llm-provider.ts).
//
// The schema lives HERE, in shared, for the reason the entity types do: it is
// described once. Its enums and — as prose in the descriptions — its id rule
// and its bounds are built from the very constants the
// server's semantic validation uses (`validateOutlineReply` in
// server/src/generate-pipeline.ts), so the shape the model is forced into and
// the shape the server accepts cannot drift apart — a schema that allowed a
// fourth scene type would be a run that fails validation on a reply the API
// promised was valid.
//
// What the schema does NOT do is replace the validation. A schema can say
// „a string matching this pattern"; it cannot say „this id appears only once
// in the whole run", „this ref names a scene of THIS outline" or „the chapter
// comes from the context". Those are the semantic checks, and they stay where
// they are.

import { SCENE_TYPES } from "./types";
import { ENTITY_SLUG } from "./slug";

/**
 * The most parts ONE outline may produce — 12 scenes and 12 suggested
 * entries, counted separately (issue #102).
 *
 * Without the bound the outline decides how many provider calls a run makes,
 * and a source text that is a whole adventure turns one „Entwürfe
 * generieren" into dozens of calls the DM never asked for. Here rather than
 * in the server since #107: the schema SAYS the bound (in the array's
 * description — `maxItems` is not allowed in strict mode) and the validation
 * enforces it, and both read the same number.
 */
export const MAX_OUTLINE_SCENES = 12;
export const MAX_OUTLINE_ENTRIES = 12;

/** The two kinds an outline entry can have — an npc or a location. */
export const OUTLINE_ENTRY_KINDS = ["npc", "location"] as const;

/**
 * The id rule as PROSE for the model. It is not a schema `pattern`: OpenAI's
 * strict mode rejects `pattern` (and `minItems`/`maxItems`) outright, and a
 * rejected schema means a permanent silent downgrade to plain `json_object`
 * for the whole process — the guard would cost more than it buys (issue #107
 * review). The rule itself is enforced where it always was, in
 * `validateOutlineReply`; here it only has to be SAID.
 *
 * Built from ENTITY_SLUG so the sentence and the check cannot drift apart.
 */
export const OUTLINE_ID_DESCRIPTION =
  "Kleinbuchstaben, Ziffern und Bindestriche, keine Umlaute " +
  `(Muster: ${ENTITY_SLUG.source}).`;

/** The tool / schema name both providers send the outline under. */
export const OUTLINE_SCHEMA_NAME = "run_outline";

/** What the tool's description tells the model it is for (Claude path). */
export const OUTLINE_SCHEMA_DESCRIPTION =
  "Die Gliederung dieses Generierungs-Durchlaufs: welche Szenen entstehen, " +
  "welche Figuren und Orte neu sind, und welche Warnungen der DM lesen soll.";

/** A JSON-schema object, as far as this module builds them. */
export type JsonSchema = Record<string, unknown>;

/**
 * The outline schema. A FUNCTION rather than a frozen constant because both
 * providers hand it to `JSON.stringify` inside a request body and one of them
 * (the OpenAI path) mutates nothing but adds `strict`; handing out a fresh
 * object keeps that honest.
 *
 * `additionalProperties: false` everywhere, because `strict: true` on the
 * OpenAI path requires it — and because a key the server ignores is a key the
 * model spent tokens on. `required` lists every property for the same reason:
 * OpenAI's strict mode has no optional properties, so the ones that are
 * genuinely optional in the data (`location`, `sourceExcerpt`) are nullable
 * instead, and the server reads `null` as „not given“ (stringField).
 */
export function outlineJsonSchema(): JsonSchema {
  const id: JsonSchema = { type: "string", description: OUTLINE_ID_DESCRIPTION };
  return {
    type: "object",
    additionalProperties: false,
    required: ["scenes", "entries", "warnings"],
    properties: {
      scenes: {
        type: "array",
        description: `Mindestens eine, höchstens ${MAX_OUTLINE_SCENES} Szenen.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "type", "location", "sourceExcerpt", "refs"],
          properties: {
            id,
            title: { type: "string" },
            type: { type: "string", enum: [...SCENE_TYPES] },
            location: {
              type: ["string", "null"],
              description: "Orts-id aus dem Kontext oder aus entries; null, wenn keine.",
            },
            sourceExcerpt: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["first", "last"],
              description:
                "Erster und letzter Satz des Quelltext-Abschnitts, wörtlich; null, wenn keine.",
              properties: {
                first: { type: "string" },
                last: { type: "string" },
              },
            },
            refs: {
              type: "array",
              items: id,
              description: "ids anderer Szenen DIESER Gliederung.",
            },
          },
        },
      },
      entries: {
        type: "array",
        description: `Höchstens ${MAX_OUTLINE_ENTRIES} neue Figuren und Orte.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "id", "name", "summary"],
          properties: {
            kind: { type: "string", enum: [...OUTLINE_ENTRY_KINDS] },
            id,
            name: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}
