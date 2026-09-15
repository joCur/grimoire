// The JSON schema of a DOCUMENT reply (issue #107, PO decision of 15.09.).
//
// Every generator call answers a JSON object now, and every one of them is
// FORCED into its schema by the provider — the outline was the first
// (./outline-schema), the four document replies followed for the same reason:
// a shape the API guarantees is a shape no correction turn has to buy.
//
// The shape is the same for all of them, and it MIRRORS THE STORED OBJECT:
//
//     { "properties": { "id": "night-watch-quay", … }, "body": "## Flow\n…",
//       "warnings": ["Der Quelltext nennt keinen DC — DC 13 gesetzt."] }
//
// `properties` is typed PER KIND from the very field definitions the
// properties dialog is built from (./property-fields) — so the fields a model
// may write and the fields the DM can edit are one list, and neither can grow
// a key the other does not know. `body` is the markdown below the frontmatter
// block, as one string; the server composes the frontmatter itself and never
// asks the model for it. `warnings` is what the DM reads in the review.
//
// What the raw-document format of this branch's earlier slices did instead —
// the reply IS the markdown file — is gone: it traded JSON escaping for
// frontmatter parsing, and the parsing was the half we could not force. A
// forced object cannot miss the `---`, cannot fence itself, cannot append a
// sign-off, and cannot break on a quotation mark: the transport escapes the
// body, and the body travels verbatim (the PO case of 15.09.).
//
// STRICT MODE rules this file, because the OpenAI-compatible path sends
// `strict: true` and a schema it rejects is a permanent downgrade for the
// whole process (llm-provider.ts):
//
//   * no `pattern`, no `format`, no `minItems`/`maxItems`/`minLength` — what
//     cannot be said in the schema is said in a `description` and enforced
//     where it always was, in the server's validation,
//   * `additionalProperties: false` everywhere,
//   * every property in `required` — a genuinely optional field is NULLABLE
//     instead, and the server reads `null` as „not given" (it drops the key
//     before it composes the frontmatter),
//   * a free key/value map (`quickstats`) cannot be expressed at all, so it
//     travels as a LIST of `{ key, value }` pairs and the server folds it
//     back into the mapping the format contract asks for.

import { propertyFieldsFor, type PropertyFieldDef } from "./property-fields";
import { OUTLINE_ID_DESCRIPTION, type JsonSchema } from "./outline-schema";

/** The kinds a generator call can write a document for. */
export const DOCUMENT_KINDS = ["scene", "npc", "location"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Which run the schema is for:
 *
 *   create    a scene part, an entry part, the NPC run — the document is NEW,
 *             so a scene's `status` can only be `draft`,
 *   augment   the „Mit KI ergänzen" run — the document EXISTS, so its status
 *             is whatever the DM made it and the schema must not narrow it.
 */
export type DocumentMode = "create" | "augment";

/** The key of the `quickstats` pair list — see the strict-mode note above. */
export const PAIR_KEY = "key";
export const PAIR_VALUE = "value";

/** The tool / schema name a document request travels under. */
export function documentSchemaName(kind: DocumentKind, mode: DocumentMode): string {
  return mode === "augment" ? "augmented_document" : `${kind}_document`;
}

const KIND_WORD: Record<DocumentKind, string> = {
  scene: "Szene",
  npc: "Figur",
  location: "Ort",
};

/** What the tool's description tells the model it is for (Claude path). */
export function documentSchemaDescription(kind: DocumentKind, mode: DocumentMode): string {
  const word = KIND_WORD[kind];
  return mode === "augment"
    ? `Der vollständige ergänzte Eintrag (${word}): Frontmatter-Felder, der ganze ` +
        "Fließtext und die Warnungen für den DM."
    : `Die fertige ${word}: Frontmatter-Felder, Fließtext und die Warnungen für den DM.`;
}

/** Whether a nullable field's value is „not given" — the server's own rule. */
export function isNotGiven(value: unknown): boolean {
  return value === null || value === undefined;
}

/** The schema of ONE field's value, per its control (see ./property-fields). */
function fieldSchema(field: PropertyFieldDef, required: boolean): JsonSchema {
  const nullable = !required;
  const type = (base: string): string[] | string => (nullable ? [base, "null"] : base);
  switch (field.control) {
    case "select": {
      const values: unknown[] = [...(field.values ?? [])];
      return {
        type: type("string"),
        enum: nullable ? [...values, null] : values,
      };
    }
    case "references":
    case "chips":
      return { type: type("array"), items: { type: "string" } };
    case "pairs":
      return {
        type: type("array"),
        description:
          "Schlüssel/Wert-Paare; die Werte sind immer Strings " +
          '(„+2", nicht 2 — sonst verschluckt YAML das Plus).',
        items: {
          type: "object",
          additionalProperties: false,
          required: [PAIR_KEY, PAIR_VALUE],
          properties: {
            [PAIR_KEY]: { type: "string" },
            [PAIR_VALUE]: { type: "string" },
          },
        },
      };
    case "reference":
      return {
        type: type("string"),
        description: `id aus der Kontextliste oder der Gliederung. ${OUTLINE_ID_DESCRIPTION}`,
      };
    default:
      return { type: type("string") };
  }
}

/**
 * The `properties` half of a reply: the kind's fields plus the `id` the
 * server addresses the document by.
 *
 * A SCENE created by a run can only be a draft — the review is what promotes
 * it — so in `create` mode its `status` is narrowed to that one value instead
 * of offering the model a lifecycle it has no business setting. Everything
 * else is the field list verbatim.
 */
export function propertiesJsonSchema(kind: DocumentKind, mode: DocumentMode): JsonSchema {
  const fields = propertyFieldsFor(kind) ?? [];
  const properties: Record<string, JsonSchema> = {
    id: { type: "string", description: OUTLINE_ID_DESCRIPTION },
  };
  for (const field of fields) {
    const draftOnly = kind === "scene" && mode === "create" && field.key === "status";
    properties[field.key] = draftOnly
      ? { type: "string", enum: ["draft"], description: "Neue Szenen sind immer Entwürfe." }
      : fieldSchema(field, field.required === true);
  }
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/**
 * The whole reply schema of one document call. A FUNCTION rather than a
 * constant for the reason `outlineJsonSchema` is one: both transports hand it
 * to `JSON.stringify` inside a request body, and a fresh object keeps that
 * honest.
 */
export function documentJsonSchema(kind: DocumentKind, mode: DocumentMode): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["properties", "body", "warnings"],
    properties: {
      properties: propertiesJsonSchema(kind, mode),
      body: {
        type: "string",
        description:
          "Der Fließtext unter dem Frontmatter-Block, als EIN String mit echten " +
          "Zeilenumbrüchen — Überschriften, Callouts und `## If:`-Abschnitte wie im " +
          "Ziel-Format. Ohne Frontmatter: den Block baut der Server aus `properties`.",
      },
      warnings: {
        type: "array",
        description: "Kurze deutsche Hinweise für den DM; leer, wenn es nichts zu melden gibt.",
        items: { type: "string" },
      },
    },
  };
}

/** Name + description + schema, the shape a provider request carries. */
export function documentReplySchema(
  kind: DocumentKind,
  mode: DocumentMode,
): { name: string; description: string; schema: JsonSchema } {
  return {
    name: documentSchemaName(kind, mode),
    description: documentSchemaDescription(kind, mode),
    schema: documentJsonSchema(kind, mode),
  };
}
