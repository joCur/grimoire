// The replies of a CHAPTER CHECK's two steps (decisions/generator): first one
// call per scene, npc and location of the chapter names that row's own terms
// as it writes them; then one call merges those lists and names the terms the
// chapter writes in different ways.
//
// Both shapes are derived from the run's term (`runTermSchema`,
// ./generator-job.ts), so what the model is forced into and what the job
// stores cannot drift apart:
//
//   terms reply  every term of ONE row: its wording as the row writes it,
//                what it is and its kind — no rendering yet, the row only
//                says how it writes it;
//   merge reply  every term of the chapter with its description, its kind and
//                a proposed rendering, plus each way the chapter writes it
//                and the rows it stands in, each row named by its key
//                (`scene:<id>`, `npc:<id>`, `location:<id>`) — the key of the
//                part that fixes it.

import { z } from "zod";
import { runTermSchema, runTermVariantSchema } from "./generator-job";

/** One term as one row of the chapter writes it. */
export const checkRowTermSchema = runTermSchema.pick({
  wording: true,
  description: true,
  kind: true,
});

export type CheckRowTerm = z.infer<typeof checkRowTermSchema>;

/** The reply of the call that names one row's own terms. */
export const checkTermsReplySchema = z.strictObject({
  terms: z.array(checkRowTermSchema),
});

/** One way the chapter writes a term, with the keys of the rows it stands in. */
export const checkMergeVariantSchema = runTermVariantSchema.extend({
  places: z.array(z.string()),
});

/** One term of the merge reply: the run's term with its variants. */
export const checkMergeTermSchema = runTermSchema.extend({
  variants: z.array(checkMergeVariantSchema),
});

export type CheckMergeTerm = z.infer<typeof checkMergeTermSchema>;

/** The reply of the call that merges the rows' lists. */
export const checkMergeReplySchema = z.strictObject({
  terms: z.array(checkMergeTermSchema),
});
