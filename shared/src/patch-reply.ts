// The reply of a PATCH call: what the model changes about one proposal of a
// generator run once the DM has answered its notes (decisions/generator: an
// answer patches the proposal instead of writing it again).
//
// The reply is a list of operations, and each entity derives its own from its
// reply schema (./scene.ts, ./npc.ts, ./location.ts), so the provider enforces
// exactly the fields that entity has:
//
//   set          one field and its new value, in the reply form of that field
//                — every field but the id and `body`;
//   replace,     one block of `body`, named by its complete text
//   insertAfter, (./body-patch.ts);
//   remove
//   note         a sentence for the DM, when an answer needs no change.
//
// Every operation is a union branch of its own, so a `set` of a field carries
// that field's own value schema — the transport guarantees the value's shape,
// and the server judges only what a schema cannot say.

import { z } from "zod";
import {
  blockInsertSchema,
  blockRemoveSchema,
  blockReplaceSchema,
  type BodyOperation,
} from "./body-patch";

/** A sentence for the DM — the answer needs no change. */
export const patchNoteSchema = z.strictObject({
  op: z.enum(["note"]),
  text: z.string(),
});

/** One operation of a patch reply, whatever entity it is about. */
export type PatchOperation =
  | { op: "set"; field: string; value: unknown }
  | BodyOperation
  | z.infer<typeof patchNoteSchema>;

/** The reply of a patch call for one entity — see the head of this module. */
export type PatchReplySchema = z.ZodObject<{
  operations: z.ZodArray<z.ZodType<PatchOperation>>;
}>;

/**
 * The patch reply of an entity whose settable fields are `fields` — the
 * entity's reply schema without its id, its `body` and its `warnings`.
 */
export function patchReplySchema(fields: z.ZodObject): PatchReplySchema {
  const sets = Object.entries(fields.shape).map(([field, value]) =>
    z.strictObject({ op: z.enum(["set"]), field: z.enum([field]), value: value as z.ZodType }),
  );
  const operation = z.union([
    ...sets,
    blockReplaceSchema,
    blockInsertSchema,
    blockRemoveSchema,
    patchNoteSchema,
  ] as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]]);
  return z.strictObject({
    operations: z.array(operation as unknown as z.ZodType<PatchOperation>),
  });
}
