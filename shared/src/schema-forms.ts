// The forms an entry kind's zod schema is DERIVED into (ADR #31).
//
// Every entry kind has exactly one zod schema: the entry as `GET
// …/entries/<address>` answers it. Everything else a kind needs is a form of
// that one schema, derived here and never written down a second time:
//
//   the PATCH     `{ rev, force?, body?, ...Partial<fields> }` — every field
//                 optional, and an optional field NULLABLE on top, because
//                 `null` is how a patch clears it,
//   the DRAFT     the entry without its address and its guard (`path`,
//                 `rev`) — what a fixture holds and what the generator
//                 proposes; the kind module omits the two keys itself,
//   the REPLY     the draft in the generator's strict form: nullable instead
//                 of optional, nothing extra allowed, every key required, and
//                 the notes for the DM beside the body — turned into the JSON
//                 schema the provider enforces by `z.toJSONSchema`.
//
// The helpers are kind-agnostic on purpose: a kind module hands in its field
// shape and gets the forms back, so a new field is one line in the kind's
// schema and nowhere else.

import { z } from "zod";
import { OUTLINE_ID_DESCRIPTION, type JsonSchema } from "./outline-schema";

// --- the patch -------------------------------------------------------------

/** One field of a patch: optional, and nullable when the entry may lack it. */
type PatchField<T> = T extends z.ZodOptional<infer Inner>
  ? z.ZodOptional<z.ZodNullable<Inner>>
  : T extends z.ZodType
    ? z.ZodOptional<T>
    : never;

/** The field shape of a patch — see `patchForm`. */
export type PatchShape<S extends z.ZodRawShape> = { [K in keyof S]: PatchField<S[K]> };

/**
 * The PATCH form of a kind: its fields, each optional, the optional ones
 * nullable as well (`null` clears the field); the guard `rev`, the conflict
 * answer `force` and the text `body` beside them; and `id`, which a client
 * may echo but never change (ADR #21 — the kind module refuses a different
 * one). Strict: a key that is none of these is a field the entry does not
 * have, and the parse names it.
 */
export function patchForm<S extends z.ZodRawShape>(fields: S) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    shape[key] =
      field instanceof z.ZodOptional
        ? (field.unwrap() as z.ZodType).nullable().optional()
        : (field as z.ZodType).optional();
  }
  return z.strictObject({
    rev: z.number(),
    force: z.boolean().optional(),
    body: z.string().optional(),
    id: z.string().optional(),
    ...(shape as PatchShape<S>),
  });
}

// --- the generator reply ---------------------------------------------------

/**
 * What every entry reply's `id` says: the kebab rule as PROSE. The rule is
 * not a `pattern` — strict mode refuses one — and is enforced where it always
 * was, in the server's validation.
 */
export const REPLY_ID_DESCRIPTION = OUTLINE_ID_DESCRIPTION;

/** What a reply's `body` is. */
export const REPLY_BODY_DESCRIPTION =
  "Der Text des Eintrags, als EIN String mit echten Zeilenumbrüchen — Überschriften, " +
  "Callouts und `## If:`-Abschnitte wie im Prompt beschrieben. Die Eigenschaften stehen " +
  "als eigene Felder neben dem Text.";

/** What a reply's `warnings` are. */
export const REPLY_WARNINGS_DESCRIPTION =
  "Kurze deutsche Hinweise für den DM; leer, wenn es nichts zu melden gibt.";

/** One field of a reply: nullable where the entry field is optional. */
type ReplyField<T> = T extends z.ZodOptional<infer Inner> ? z.ZodNullable<Inner> : T;

/** The shape of a reply — see `replyForm`. */
export type ReplyShape<S extends z.ZodRawShape> = { [K in keyof S]: ReplyField<S[K]> };

/**
 * The REPLY form of a draft shape: every optional field nullable instead —
 * strict mode knows no optional property, so the model says „not given" with
 * `null` — each field with the description the kind hands in, and the
 * `warnings` for the DM beside the body. `title` names the schema (the tool
 * or schema name a request travels under), `description` says what the reply
 * is for.
 */
export function replyForm<S extends z.ZodRawShape>(
  draft: S,
  meta: {
    title: string;
    description: string;
    fields?: Partial<Record<keyof S & string, string>>;
  },
) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(draft)) {
    const nullable =
      field instanceof z.ZodOptional
        ? (field.unwrap() as z.ZodType).nullable()
        : (field as z.ZodType);
    const description = meta.fields?.[key as keyof S & string];
    shape[key] = description === undefined ? nullable : nullable.describe(description);
  }
  return z
    .strictObject({
      ...(shape as ReplyShape<S>),
      warnings: z.array(z.string()).describe(REPLY_WARNINGS_DESCRIPTION),
    })
    .meta({ title: meta.title, description: meta.description });
}

/**
 * The JSON schema a provider request carries, derived from a reply form. The
 * `$schema` marker is dropped: a request carries the schema as data, and a
 * strict provider has no use for the dialect line.
 */
export function replyJsonSchema(reply: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(reply) as JsonSchema;
  return schema;
}
