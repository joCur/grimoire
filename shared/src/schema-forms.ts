// The forms a kind's zod schema is DERIVED into (ADR #31).
//
// Every kind with its own resource has exactly one zod schema: the object its
// resource answers. Everything else the kind needs is a form of that one
// schema, derived here and never written down a second time:
//
//   the PATCH     `{ rev, force?, ...Partial<fields> }` — every field
//                 optional, an optional field NULLABLE on top, because `null`
//                 is how a patch clears it,
//   the REPLY     the kind without its guard in the generator's strict form:
//                 nullable instead of optional, nothing extra allowed, every
//                 key required, and the notes for the DM beside the fields —
//                 turned into the JSON schema the provider enforces by
//                 `z.toJSONSchema`.
//
// The helpers know no kind: a kind module hands in its field shape and gets
// the forms back.

import { z } from "zod";
import { OUTLINE_ID_DESCRIPTION, type JsonSchema } from "./outline-schema";

// --- the patch -------------------------------------------------------------

/** One field of a patch: optional, and nullable when the kind may lack it. */
type PatchField<T> = T extends z.ZodOptional<infer Inner>
  ? z.ZodOptional<z.ZodNullable<Inner>>
  : T extends z.ZodType
    ? z.ZodOptional<T>
    : never;

/** The field shape of a patch — see `patchForm`. */
export type PatchShape<S extends z.ZodRawShape> = { [K in keyof S]: PatchField<S[K]> };

/**
 * The PATCH form of a kind: its fields, each optional, the optional ones
 * nullable as well (`null` clears the field), beside the guard `rev` and the
 * conflict answer `force`. Strict: a key that is none of these is a field the
 * kind does not have, and the parse names it.
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
    ...(shape as PatchShape<S>),
  });
}

// --- the generator reply ---------------------------------------------------

/**
 * What every reply's `id` says: the kebab rule as PROSE. The rule is not a
 * `pattern` — strict mode refuses one — and is enforced where it always was,
 * in the server's validation.
 */
export const REPLY_ID_DESCRIPTION = OUTLINE_ID_DESCRIPTION;

/** What a reply's `body` is. */
export const REPLY_BODY_DESCRIPTION =
  "Der Markdown-Text, als EIN String mit echten Zeilenumbrüchen — Überschriften, " +
  "Callouts und `## If:`-Abschnitte wie im Prompt beschrieben.";

/** What a reply's `warnings` are. */
export const REPLY_WARNINGS_DESCRIPTION =
  "Kurze deutsche Hinweise für den DM; leer, wenn es nichts zu melden gibt.";

/** One field of a reply: nullable where the kind's field is optional. */
type ReplyField<T> = T extends z.ZodOptional<infer Inner> ? z.ZodNullable<Inner> : T;

/** The shape of a reply — see `replyForm`. */
export type ReplyShape<S extends z.ZodRawShape> = { [K in keyof S]: ReplyField<S[K]> };

/**
 * The REPLY form of a field shape: every optional field nullable instead —
 * strict mode knows no optional property, so the model says „not given" with
 * `null` — each field with the description the kind hands in, and the
 * `warnings` for the DM beside them. `title` names the schema (the tool or
 * schema name a request travels under), `description` says what the reply is
 * for.
 */
export function replyForm<S extends z.ZodRawShape>(
  fields: S,
  meta: {
    title: string;
    description: string;
    fields?: Partial<Record<keyof S & string, string>>;
  },
) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
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
