// The reply schema of a SCENE call — one plain schema per run.
//
// Every generator call answers a JSON object, and every one of them is FORCED
// into its schema by the provider: the Claude path sends the schema as a tool
// and forces the call, an OpenAI-compatible endpoint sends it as
// `response_format: json_schema` (server/src/llm-provider.ts). A shape the
// API guarantees is a shape no correction turn has to buy.
//
// The shape mirrors the stored row of a scene: its fields under
// `properties`, beside them the text and the notes for the DM,
//
//     { "properties": { "id": "night-watch-quay", … }, "body": "## Ablauf\n…",
//       "warnings": ["Der Quelltext nennt keinen DC — DC 13 gesetzt."] }
//
// and the schemas live in ../schema, one per run; `shared/test/
// entry-schema.test.ts` asserts that their keys and enums still match the
// field definitions the dialog is built from (./property-fields). The npc and
// the location derive their reply schemas from their zod schemas instead
// (ADR #31, ./npc.ts `npcReplySchema`, ./location.ts `locationReplySchema`).
//
// `body` is the whole text as one string and `warnings` what the
// DM reads in the review. The body travels verbatim: a forced object cannot
// miss a delimiter, fence itself, append a sign-off or break on a quotation
// mark.
//
// STRICT MODE rules those schemas, because the OpenAI-compatible path sends
// `strict: true` and a schema it rejects is a permanent downgrade for the
// whole process:
//
//   * no `pattern`, no `format`, no `minItems`/`maxItems`/`minLength` — what
//     cannot be said in the schema is said in a `description` and enforced
//     where it always was, in the server's validation,
//   * `additionalProperties: false` everywhere,
//   * every property in `required` — a genuinely optional field is NULLABLE
//     instead, and the server reads `null` as „not given" (it drops the key
//     before the row is written).

import type { JsonSchema } from "./outline-schema";
import augmentedSceneEntry from "../schema/augmented-scene.schema.json";
import sceneEntry from "../schema/scene.schema.json";

/**
 * The kinds whose generator reply carries `properties` — a scene. A chapter
 * comes out of the run itself (ADR #18), the campaign is nobody's proposal,
 * and an npc and a location have their own reply forms (./npc.ts,
 * ./location.ts).
 */
export const GENERATED_ENTRY_KINDS = ["scene"] as const;
export type GeneratedEntryKind = (typeof GENERATED_ENTRY_KINDS)[number];

/**
 * Which run the schema is for:
 *
 *   create    a scene part — the scene is NEW, so its `status` can only be
 *             `draft`,
 *   augment   the „Mit KI ergänzen" run — the scene EXISTS, so its status
 *             is whatever the DM made it and the schema must not narrow it.
 *
 * Each run has its own schema; the narrowing is written down in the create
 * schema rather than applied to a shared one at runtime.
 */
export type EntryMode = "create" | "augment";

/** Every entry schema, by kind and run — loaded once, at start. */
const ENTRY_SCHEMAS: Record<EntryMode, Record<GeneratedEntryKind, JsonSchema>> = {
  create: {
    scene: sceneEntry,
  },
  augment: {
    scene: augmentedSceneEntry,
  },
};

/** Whether a nullable field's value is „not given" — the server's own rule. */
export function isNotGiven(value: unknown): boolean {
  return value === null || value === undefined;
}

/** The tool / schema name an entry request travels under (the schema `title`). */
export function entrySchemaName(kind: GeneratedEntryKind, mode: EntryMode): string {
  return String(ENTRY_SCHEMAS[mode][kind].title);
}

/** What the tool's description tells the model it is for (Claude path). */
export function entrySchemaDescription(kind: GeneratedEntryKind, mode: EntryMode): string {
  return String(ENTRY_SCHEMAS[mode][kind].description);
}

/**
 * The whole reply schema of one entry call. A COPY on every call, not the
 * loaded object: both transports hand it to `JSON.stringify` inside a request
 * body, and a caller that could reach into the module's own state would make
 * the next request's payload depend on the last one's.
 */
export function entryJsonSchema(kind: GeneratedEntryKind, mode: EntryMode): JsonSchema {
  return structuredClone(ENTRY_SCHEMAS[mode][kind]);
}

/** Name + description + schema, the shape a provider request carries. */
export function entryReplySchema(
  kind: GeneratedEntryKind,
  mode: EntryMode,
): { name: string; description: string; schema: JsonSchema } {
  return {
    name: entrySchemaName(kind, mode),
    description: entrySchemaDescription(kind, mode),
    schema: entryJsonSchema(kind, mode),
  };
}
