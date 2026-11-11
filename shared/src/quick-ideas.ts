// A QUICK-IDEAS QUESTION — the DM asking the model for ideas at the table, in
// the live view of a running session — and its reply: the one zod schema of
// each and the types derived from them (decisions/resources).
//
// The quick-ideas chat is no entity: nothing of it is stored, so it has no
// `id` and no `rev`. The conversation lives in the open live view, and every
// question sends it whole, because the server keeps nothing between two
// questions (decisions/generator).

import { z } from "zod";

/** Who wrote a turn of the conversation: the DM, or the model replying. */
export const QUICK_IDEAS_ROLES = ["dm", "model"] as const;

export type QuickIdeasRole = (typeof QUICK_IDEAS_ROLES)[number];

/** One turn of the conversation: who wrote it and its text, Markdown. */
export const quickIdeasTurnSchema = z.strictObject({
  role: z.enum(QUICK_IDEAS_ROLES),
  text: z.string(),
});

export type QuickIdeasTurn = z.infer<typeof quickIdeasTurnSchema>;

/**
 * The body of `POST /api/campaigns/:c/sessions/:s/quick-ideas`: `scene` the
 * scene open in the live view, and `messages` the conversation so far in the
 * order it was written, the DM's question last.
 */
export const quickIdeasQuestionSchema = z.strictObject({
  scene: z.string(),
  messages: z.array(quickIdeasTurnSchema).min(1),
});

export type QuickIdeasQuestion = z.infer<typeof quickIdeasQuestionSchema>;

/** What the question answers with: the model's reply, Markdown. */
export const quickIdeasReplySchema = quickIdeasTurnSchema.pick({ text: true });

export type QuickIdeasReply = z.infer<typeof quickIdeasReplySchema>;
