// A CHAPTER — its one zod schema and the forms derived from it (ADR #31).
//
// `chapterSchema` is the chapter as `GET /api/campaigns/:c/chapters/:id`
// answers it. The TypeScript type, the PATCH and the POST the resource
// accepts, and the chapter a fixture holds and a new-chapter run creates
// are each derived from it below with zod's own API, so a new field of a
// chapter is one line in the schema and one in its form fields.
//
// What a chapter says about its scenes — their order — is not a field of the
// chapter: it has its own endpoint and its own guard (ADR #27). Its threads
// are an entity of their own (./thread.ts), each naming its chapter.

import { z } from "zod";

/**
 * A chapter's lifecycle states, in that order. `active` is the ONE the app
 * acts on — the session view opens the active chapter —, and there is at
 * most one per campaign: the write that makes a chapter active puts the one
 * that was active back to `planned` in the same transaction. A CHECK
 * constraint holds the column to these three (ADR #25).
 */
export const CHAPTER_STATUSES = ["planned", "active", "done"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

/**
 * A chapter, exactly as `GET /api/campaigns/:c/chapters/:id` answers it: `id`
 * its stable key — the `chapter` a scene, an npc or a location names —,
 * `title` the display name (the id stands in for a chapter that has none),
 * `status` where it stands in the campaign, `body` its markdown — what the
 * chapter is about —, and `rev` the row version a PATCH sends back as its
 * guard.
 */
export const chapterSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  status: z.enum(CHAPTER_STATUSES).optional(),
  body: z.string(),
  rev: z.number(),
});

export type Chapter = z.infer<typeof chapterSchema>;

/**
 * A chapter without its guard: what a fixture holds
 * (`fixtures/<campaign>/chapters/<id>.json`) and what a new-chapter run
 * creates when it is accepted.
 */
export const chapterProposalSchema = chapterSchema.omit({ rev: true });

export type ChapterProposal = z.infer<typeof chapterProposalSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/chapters/:id`: the guard, the optional
 * `force`, and any subset of the fields — `body` is one of them, and `null`
 * clears the status. `status: "active"` makes the chapter the active one. The
 * id may be echoed, never changed. Strict like the schema it comes from: a
 * key that is none of these is a 400 naming it.
 */
export const chapterPatchSchema = chapterProposalSchema
  .extend({ status: z.enum(CHAPTER_STATUSES).nullable() })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type ChapterPatch = z.infer<typeof chapterPatchSchema>;

/** The fields of one chapter write, guard and `force` aside — what an editing surface builds. */
export const chapterChangeSchema = chapterPatchSchema.omit({ rev: true, force: true });

export type ChapterChange = z.infer<typeof chapterChangeSchema>;

/**
 * The body of `POST /api/campaigns/:c/chapters`: the typed title, the id the
 * DM set (absent: derived from the title), the status it starts at (absent:
 * `planned`; `active` makes it the active chapter) and its `body` — what the
 * chapter is about, as typed.
 */
export const chapterCreateSchema = chapterProposalSchema
  .pick({ title: true, status: true, body: true })
  .partial({ status: true, body: true })
  .extend({ id: z.string().optional() });

export type ChapterCreate = z.infer<typeof chapterCreateSchema>;
