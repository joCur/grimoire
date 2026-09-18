// The reply schema of the generator's OUTLINE call, plus the bounds the
// server's own validation reads.
//
// The outline is a small, flat object — which scenes exist, what they are
// called, which ids the run introduces — and both providers force it: the
// Claude provider sends the schema as a tool and forces the call, an
// OpenAI-compatible endpoint sends it as `response_format: json_schema`
// (server/src/llm-provider.ts).
//
// The schema itself is plain data, ../schema/outline.schema.json: nothing
// here assembles it, this module loads it and hands it to the provider. Its
// enums and the numbers its descriptions name are asserted against the
// constants below in `shared/test/entry-schema.test.ts`, so the shape the
// model is forced into and the shape the server accepts cannot drift apart —
// a schema that allowed a fourth scene type would be a run that fails
// validation on a reply the API promised was valid.
//
// What the schema does NOT do is replace the validation. A schema can say
// „a string matching this pattern"; it cannot say „this id appears only once
// in the whole run", „this ref names a scene of THIS outline" or „the chapter
// comes from the context". Those are the semantic checks
// (`validateOutlineReply` in server/src/generate-pipeline.ts), and they stay
// where they are.

import { ENTITY_SLUG } from "./slug";
import outlineSchema from "../schema/outline.schema.json";

/**
 * The most parts ONE outline may produce — 12 scenes and 12 suggested
 * entries, counted separately.
 *
 * Without the bound the outline decides how many provider calls a run makes,
 * and a source text that is a whole adventure turns one „Entwürfe
 * generieren" into dozens of calls the DM never asked for. The schema SAYS
 * the bound (in the array's description — `maxItems` is not allowed in strict
 * mode) and the validation enforces it, and both read the same number.
 */
export const MAX_OUTLINE_SCENES = 12;
export const MAX_OUTLINE_ENTRIES = 12;

/** The two kinds an outline entry can have — an npc or a location. */
export const OUTLINE_ENTRY_KINDS = ["npc", "location"] as const;

/**
 * The id rule as PROSE for the model, as the schema modules spell it out. It is
 * not a schema `pattern`: OpenAI's strict mode rejects `pattern` (and
 * `minItems`/`maxItems`) outright, and a rejected schema means a permanent
 * silent downgrade to plain `json_object` for the whole process — the guard
 * would cost more than it buys. The rule itself is enforced where it always
 * was, in `validateOutlineReply`; here it only has to be SAID.
 *
 * Built from ENTITY_SLUG so the sentence and the check cannot drift apart.
 */
export const OUTLINE_ID_DESCRIPTION =
  "Kleinbuchstaben, Ziffern und Bindestriche, keine Umlaute " +
  `(Muster: ${ENTITY_SLUG.source}).`;

/** A JSON-schema object, as far as this package hands them around. */
export type JsonSchema = Record<string, unknown>;

/** The tool / schema name both providers send the outline under. */
export const OUTLINE_SCHEMA_NAME = String(outlineSchema.title);

/** What the tool's description tells the model it is for (Claude path). */
export const OUTLINE_SCHEMA_DESCRIPTION = String(outlineSchema.description);

/**
 * The outline schema. A COPY on every call, not the loaded object: both
 * providers hand it to `JSON.stringify` inside a request body, and a caller
 * that could reach into this module's own state would make the next
 * request's payload depend on the last one's.
 */
export function outlineJsonSchema(): JsonSchema {
  return structuredClone(outlineSchema) as JsonSchema;
}
