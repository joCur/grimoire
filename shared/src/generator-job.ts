// A GENERATOR JOB — one run of the generator and the DM's review of what it
// proposed — its one zod schema and the forms derived from it (ADR #31).
//
// `generatorJobSchema` is the job as `GET /api/campaigns/:c/generator-jobs/:id`
// answers it. The TypeScript type, the POST that starts a run, the PATCH that
// reviews and accepts it, the PATCH that retries one of its parts and the
// DELETE that discards it are each derived from it below with zod's own API.
//
// A campaign has at most ONE job, whatever its kind: a start while a run is
// going is refused, and a finished run is replaced by the next start. A
// finished job keeps what it proposed until the DM has accepted, dropped or
// rejected every proposal — then the job is gone — or discards it.
//
// The proposals are the entities themselves without their guard: a scene
// run's scenes, npcs and locations each in their own typed list, an npc run's
// one npc, and an augment run's reading of one scene, npc or location beside
// the model's proposal for it. Nothing a job proposes is a row of the
// campaign until it is accepted.

import { z } from "zod";
import { locationProposalSchema } from "./location";
import { npcChangeSchema, npcProposalSchema } from "./npc";
import { sceneChangeSchema, sceneProposalSchema } from "./scene";

// --- what a run proposes ---------------------------------------------------

/**
 * Token spend of ONE run, summed over every provider call (the initial one
 * plus each correction turn). Absent when the endpoint reports no usage at
 * all — the UI then simply shows nothing. A failed run's error body carries
 * the same shape next to `error`, so a run that produced nothing is just as
 * visible as a successful one.
 */
export const generateUsageSchema = z.strictObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
  /** Provider calls in this run — 1 when no correction turn was needed. */
  attempts: z.number(),
});

export type GenerateUsage = z.infer<typeof generateUsageSchema>;

/** Where a naming hint sits and what it found — see `namingHintSchema`. */
const namingHintAtSchema = z.strictObject({
  /** The convention's `from` — the spelling that was found. */
  from: z.string(),
  /** The convention's `to` — what should stand there instead. */
  to: z.string(),
  /**
   * Where inside it: `"body"` together with a 1-based `line`, or the name of
   * the field (`"title"`, `"role"`, …) with `line` absent.
   */
  field: z.string(),
  /** 1-based line number inside the markdown body; absent for another field. */
  line: z.number().optional(),
  /** The line (or field value) the hit sits in, trimmed and capped. */
  excerpt: z.string(),
});

export type NamingHintAt = z.infer<typeof namingHintAtSchema>;

/**
 * One finding of the naming check after a run: a finished proposal still
 * carries a spelling that a naming convention replaces.
 *
 * A HINT, never a blocker — the check is a plain word-boundary text search
 * and cannot know whether the hit is the thing the rule means (a `from` of
 * "Salt" hits "Salt Harbour" and the word "salt"). So it reports WHERE it
 * looked and lets the DM decide; the sentence around it is built by the app
 * from its own catalog, because the server stays language-free.
 *
 * WHAT the hit sits in is named by its entity: a proposed or augmented scene
 * by its id under `scene`, an npc by its id under `npc`, a location by its id
 * under `location`.
 */
export const namingHintSchema = z.union([
  namingHintAtSchema.extend({
    scene: z.string(),
    npc: z.never().optional(),
    location: z.never().optional(),
  }),
  namingHintAtSchema.extend({
    npc: z.string(),
    scene: z.never().optional(),
    location: z.never().optional(),
  }),
  namingHintAtSchema.extend({
    location: z.string(),
    scene: z.never().optional(),
    npc: z.never().optional(),
  }),
]);

export type NamingHint = z.infer<typeof namingHintSchema>;

/**
 * What a SCENE run proposes. Mechanically validated (every scene is a draft,
 * references resolve, only known callouts); `warnings` are the model's own
 * review notes for the DM.
 */
export const generateResultSchema = z.strictObject({
  /**
   * The scenes the run proposes, each a scene without its guard and always a
   * draft — accepted or dropped one by one, by id.
   */
  scenes: z.array(sceneProposalSchema),
  /** The npcs the run proposes, each an npc without its guard. */
  npcs: z.array(npcProposalSchema),
  /** The locations the run proposes, each a location without its guard. */
  locations: z.array(locationProposalSchema),
  warnings: z.array(z.string()),
  /**
   * The SERVER's own findings, not the model's: proposals that still carry a
   * spelling a naming convention replaces. Absent or empty when the campaign
   * has no naming conventions or nothing was found — never a reason to fail
   * a run.
   */
  namingHints: z.array(namingHintSchema).optional(),
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage: generateUsageSchema.optional(),
});

export type GenerateResult = z.infer<typeof generateResultSchema>;

/**
 * What an NPC run proposes: exactly one npc and no chapter — its own shape
 * rather than a scene-less `GenerateResult`, which every reader would have to
 * special-case.
 */
export const generateNpcResultSchema = z.strictObject({
  /** The proposed npc, without its guard. */
  npc: npcProposalSchema,
  /** The model's own review notes for the DM (gaps in the source text). */
  warnings: z.array(z.string()),
  /** The naming check's findings — see `generateResultSchema`. */
  namingHints: z.array(namingHintSchema).optional(),
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage: generateUsageSchema.optional(),
});

export type GenerateNpcResult = z.infer<typeof generateNpcResultSchema>;

/**
 * What an augment run of one existing entity proposes: the entity as the run
 * read it and as the model proposes it, both in `proposal` — the entity
 * without its guard. Nothing is written: `POST …/<resource>/:id/augment/apply`
 * is the only write, and it carries the fields the DM took. The review
 * compares the two field by field; `body` is reviewed block by block.
 */
function augmentResultSchema<T extends z.ZodType>(proposal: T) {
  return z.strictObject({
    /** The entity the run is about. */
    id: z.string(),
    /** The `rev` the run READ. Informational — the write sends the UI's rev. */
    rev: z.number(),
    /** The entity as the run read it. */
    current: proposal,
    /** The entity as the model proposes it, complete. */
    proposed: proposal,
    /** The model's own review notes for the DM. */
    warnings: z.array(z.string()),
    /** The naming check's findings — see `generateResultSchema`. */
    namingHints: z.array(namingHintSchema).optional(),
    /** Token spend of the run; absent when the endpoint reports no usage. */
    usage: generateUsageSchema.optional(),
  });
}

/** What augmenting a SCENE (`POST …/scenes/:id/augment`) proposes. */
export const sceneAugmentResultSchema = augmentResultSchema(sceneProposalSchema);

export type SceneAugmentResult = z.infer<typeof sceneAugmentResultSchema>;

/** What augmenting an NPC (`POST …/npcs/:id/augment`) proposes. */
export const npcAugmentResultSchema = augmentResultSchema(npcProposalSchema);

export type NpcAugmentResult = z.infer<typeof npcAugmentResultSchema>;

/** What augmenting a LOCATION (`POST …/locations/:id/augment`) proposes. */
export const locationAugmentResultSchema = augmentResultSchema(locationProposalSchema);

export type LocationAugmentResult = z.infer<typeof locationAugmentResultSchema>;

// --- the parts of a scene run ------------------------------------------------

export const GENERATOR_JOB_PART_STATUSES = ["pending", "running", "done", "failed"] as const;
export type GeneratorJobPartStatus = (typeof GENERATOR_JOB_PART_STATUSES)[number];

/**
 * ONE part of a scene run. An OUTLINE call decides which scenes exist, and
 * then every scene, every proposed npc and every proposed location is a call
 * of its own — a PART with a status, so a form error costs that part and
 * nothing else, and a finished part is reviewable while its siblings are
 * still running.
 *
 * A part is a child of its job: read embedded in it, and retried on its own
 * resource, `PATCH …/generator-jobs/:id/parts/:key`. The outline itself never
 * travels — it is an internal step and never offered for editing.
 */
export const generatorJobPartSchema = z.strictObject({
  /** Stable key of the part (`scene:<id>`) — its address under the job. */
  key: z.string(),
  kind: z.enum(["scene", "npc", "location"]),
  /** The id the outline gave this part — the id of its scene, npc or location. */
  id: z.string(),
  /** Display title of the part; the id when the outline named none. */
  title: z.string(),
  status: z.enum(GENERATOR_JOB_PART_STATUSES),
  /** Why the part failed — the DM reads this next to the retry action. */
  error: z.string().optional(),
  /** The mechanical validation errors of a failed part, when there were any. */
  validationErrors: z.array(z.string()).optional(),
  /** The raw reply of the failed attempt (capped). */
  rawReply: z.string().optional(),
});

export type GeneratorJobPart = z.infer<typeof generatorJobPartSchema>;

/**
 * The pipeline state of a scene run: its parts in OUTLINE order plus what the
 * whole run has cost so far. Absent for the single-call runs (npc, augment).
 */
export const generatorJobPipelineSchema = z.strictObject({
  parts: z.array(generatorJobPartSchema),
  /**
   * What the chapter a new-chapter run creates is about — written by the
   * outline from the source material, and the text that chapter starts with
   * once its first scene is accepted. Absent for a run into an existing
   * chapter and when the outline brought none.
   */
  chapterDescription: z.string().optional(),
  /**
   * Summed over every provider call of every part, the outline included.
   * `calls` counts provider calls (a correction turn is one more).
   */
  totals: z.strictObject({
    inputTokens: z.number(),
    outputTokens: z.number(),
    calls: z.number(),
  }),
});

export type GeneratorJobPipeline = z.infer<typeof generatorJobPipelineSchema>;

// --- the job -----------------------------------------------------------------

export const GENERATOR_JOB_STATUSES = ["running", "done", "failed"] as const;
export type GeneratorJobStatus = (typeof GENERATOR_JOB_STATUSES)[number];

/**
 * What a run produces: proposed scenes for a chapter, one proposed npc, or a
 * proposal for an existing scene (`scene-augment`), npc (`npc-augment`) or
 * location (`location-augment`). The kind tells which result field to read.
 * A scene and an npc run start on `POST …/generator-jobs`; an augment run
 * starts on the resource of what it augments (`POST …/scenes/:id/augment`).
 */
export const GENERATOR_JOB_KINDS = [
  "scene",
  "npc",
  "scene-augment",
  "npc-augment",
  "location-augment",
] as const;
export type GeneratorJobKind = (typeof GENERATOR_JOB_KINDS)[number];

/**
 * A failed run, exactly as a synchronous answer would have carried it: the
 * HTTP status and the JSON error body — `error`, `code`, `validationErrors`,
 * `rawReply`, `usage` — so the app renders it in the same block it renders
 * any error body in.
 */
export const generatorJobErrorSchema = z.strictObject({
  status: z.number(),
  body: z.record(z.string(), z.unknown()),
});

export type GeneratorJobError = z.infer<typeof generatorJobErrorSchema>;

/** What the DM decided about one proposed npc or location. */
export const generateReviewDecisionSchema = z.enum(["accepted", "rejected"]);

export type GenerateReviewDecision = z.infer<typeof generateReviewDecisionSchema>;

/**
 * The review state of a job: what the DM DID with the proposals — a small
 * record of decisions, never a second copy of the result.
 */
export const generatorJobReviewSchema = z.strictObject({
  /** The ids of the proposed scenes the DM dropped from the run — never written. */
  droppedScenes: z.array(z.string()),
  /**
   * Augment run only: decision per FIELD. `true` accepts the proposal,
   * `false` keeps the current value; an absent key keeps the computed
   * default, so a fresh review starts from that default.
   */
  fields: z.record(z.string(), z.boolean()),
  /** Augment run only: the same per body BLOCK id. */
  blocks: z.record(z.string(), z.boolean()),
  /**
   * The ids of the proposed scenes that are ACCEPTED — rows of the campaign
   * now. A written scene is read-only in the review and links to what it
   * became.
   */
  writtenScenes: z.array(z.string()),
  /**
   * Decision per proposed npc, keyed by its id. A key that is absent is OPEN
   * — the review's third state, which is why "open" is not a value here.
   */
  npcs: z.record(z.string(), generateReviewDecisionSchema),
  /** The ids of the proposed npcs that are accepted — rows of the campaign now. */
  writtenNpcs: z.array(z.string()),
  /** Decision per proposed location, keyed by its id. Absent is open, as in `npcs`. */
  locations: z.record(z.string(), generateReviewDecisionSchema),
  /** The ids of the proposed locations that are accepted — rows of the campaign now. */
  writtenLocations: z.array(z.string()),
});

export type GeneratorJobReview = z.infer<typeof generatorJobReviewSchema>;

/**
 * What the DM may change about a proposed scene while reviewing it: any of
 * its fields but the id, which is what the change is keyed by (ADR #21).
 */
export const sceneEditSchema = sceneChangeSchema.omit({ id: true });

/** What the DM may change about a proposed npc — see `sceneEditSchema`. */
export const npcEditSchema = npcChangeSchema.omit({ id: true });

/**
 * A job, exactly as the resource answers it:
 *
 *   - `id` its key, an opaque id the server hands out at the start;
 *   - `kind` what the run produces, and `chapter` the target chapter of a
 *     scene run (a new-chapter run names the chapter it will create);
 *   - `scene`, `npc` or `location` — the id of what an augment run works on,
 *     present from the moment it starts;
 *   - `status`, `startedAt` and `finishedAt` (ISO timestamps on the server's
 *     clock, `finishedAt` once it is not running);
 *   - the proposal in the field its kind reads — `result` for a scene run,
 *     `npcResult` for an npc run, `sceneAugmentResult`, `npcAugmentResult`
 *     or `locationAugmentResult` for an augment run — and `error` for a run
 *     that failed;
 *   - `sceneEdits` and `npcEdits`, the DM's changes to a proposed scene or
 *     npc by its id: a change names the fields it sets, `null` clears an
 *     optional one, and every other field keeps the model's value;
 *   - `review`, the DM's decisions and what is already accepted;
 *   - `pipeline`, the parts of a scene run;
 *   - `rev` the row version a PATCH or a DELETE sends back as its guard. It
 *     guards the review: the run's own progress does not move it.
 *
 * A running job does not survive a restart of the server — its provider call
 * died with the process — and comes back as `failed` with a message saying
 * so; a finished one comes back whole.
 */
export const generatorJobSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(GENERATOR_JOB_KINDS),
  chapter: z.string().optional(),
  scene: z.string().optional(),
  npc: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(GENERATOR_JOB_STATUSES),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  result: generateResultSchema.optional(),
  npcResult: generateNpcResultSchema.optional(),
  sceneAugmentResult: sceneAugmentResultSchema.optional(),
  npcAugmentResult: npcAugmentResultSchema.optional(),
  locationAugmentResult: locationAugmentResultSchema.optional(),
  error: generatorJobErrorSchema.optional(),
  sceneEdits: z.record(z.string(), sceneEditSchema),
  npcEdits: z.record(z.string(), npcEditSchema),
  review: generatorJobReviewSchema,
  pipeline: generatorJobPipelineSchema.optional(),
  rev: z.number(),
});

export type GeneratorJob = z.infer<typeof generatorJobSchema>;

/**
 * The body of `POST /api/campaigns/:c/generator-jobs`: the kind of the run and
 * what it needs.
 *
 *   - a SCENE run names its target `chapter` and the `sourceText`;
 *     `newChapter` allows a chapter that does not exist yet, and
 *     `chapterTitle` is that chapter's title — kept on the job, so the accept
 *     creates the chapter in whatever browser it happens in;
 *   - an NPC run takes the `sourceText` and optionally the npc's `id`; without
 *     one the model picks it.
 *
 * An augment run is started on the resource it augments, not here. Strict
 * like every write: a key the kind does not take is a 400 naming it.
 */
export const generatorJobCreateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("scene"),
    chapter: z.string(),
    sourceText: z.string(),
    newChapter: z.boolean().optional(),
    chapterTitle: z.string().nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal("npc"),
    sourceText: z.string(),
    id: z.string().nullable().optional(),
  }),
]);

export type GeneratorJobCreate = z.infer<typeof generatorJobCreateSchema>;

/**
 * The part of the review a PATCH may change. Every key merges into the stored
 * review, so the app sends the one decision that was just made:
 *
 *   - `npcs`, `locations`, `fields` and `blocks` merge key by key, and `null`
 *     takes a decision back — to undecided, and the only way to clear
 *     decisions whose keys no longer exist;
 *   - `droppedScenes` is the whole set, because "no longer dropped" has to be
 *     expressible too;
 *   - `writtenScenes`, `writtenNpcs` and `writtenLocations` ACCEPT: every
 *     proposal they name is written into the campaign in this request and
 *     joins its list. A list only grows — an accepted proposal is a row of
 *     the campaign, not a decision to take back.
 */
export const generatorJobReviewPatchSchema = generatorJobReviewSchema.partial().extend({
  fields: z.record(z.string(), z.boolean().nullable()).optional(),
  blocks: z.record(z.string(), z.boolean().nullable()).optional(),
  npcs: z.record(z.string(), generateReviewDecisionSchema.nullable()).optional(),
  locations: z.record(z.string(), generateReviewDecisionSchema.nullable()).optional(),
});

export type GeneratorJobReviewPatch = z.infer<typeof generatorJobReviewPatchSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/generator-jobs/:id`: the guard and the
 * review's own fields — the DM's changes to a proposed scene or npc, merged
 * field by field onto the stored change of that proposal, and the review
 * (see `generatorJobReviewPatchSchema`). The run's own fields are the
 * server's. Strict like the schema it comes from: any other key is a 400
 * naming it.
 */
export const generatorJobPatchSchema = generatorJobSchema
  .pick({ id: true, sceneEdits: true, npcEdits: true })
  .partial()
  .extend({
    review: generatorJobReviewPatchSchema.optional(),
    rev: z.number(),
  });

export type GeneratorJobPatch = z.infer<typeof generatorJobPatchSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/generator-jobs/:id/parts/:key`: a
 * failed part is set `running` again — it runs once more.
 */
export const generatorJobPartPatchSchema = z.strictObject({
  status: generatorJobPartSchema.shape.status.extract(["running"]),
});

export type GeneratorJobPartPatch = z.infer<typeof generatorJobPartPatchSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/generator-jobs/:id`: the guard the job
 * was read with.
 */
export const generatorJobDeleteSchema = generatorJobSchema.pick({ rev: true });

export type GeneratorJobDelete = z.infer<typeof generatorJobDeleteSchema>;

// --- what is still open -------------------------------------------------------

/** The part of a job the questions below read. */
type JobState = Pick<GeneratorJob, "result" | "npcResult" | "review"> & {
  pipeline?: { parts: ReadonlyArray<Pick<GeneratorJobPart, "status">> };
};

/** The ids of the npcs a run proposes — a scene run's list, or the NPC run's one npc. */
export function proposedNpcIds(job: JobState): string[] {
  return [
    ...(job.result?.npcs ?? []).map((npc) => npc.id),
    ...(job.npcResult === undefined ? [] : [job.npcResult.npc.id]),
  ];
}

/** The proposed scenes that are neither accepted nor dropped, by id. */
export function openSceneIds(job: JobState): Set<string> {
  const written = new Set(job.review.writtenScenes);
  const dropped = new Set(job.review.droppedScenes);
  return new Set(
    (job.result?.scenes ?? [])
      .map((scene) => scene.id)
      .filter((id) => !written.has(id) && !dropped.has(id)),
  );
}

/** The proposed npcs that are neither accepted nor rejected, by id. */
export function openNpcIds(job: JobState): Set<string> {
  return new Set(
    proposedNpcIds(job).filter(
      (id) => !job.review.writtenNpcs.includes(id) && job.review.npcs[id] !== "rejected",
    ),
  );
}

/** The proposed locations that are neither accepted nor rejected, by id. */
export function openLocationIds(job: JobState): Set<string> {
  return new Set(
    (job.result?.locations ?? [])
      .map((location) => location.id)
      .filter(
        (id) =>
          !job.review.writtenLocations.includes(id) && job.review.locations[id] !== "rejected",
      ),
  );
}

/**
 * Is there nothing left to decide? Every part of a scene run is done, every
 * scene is accepted or dropped, and every proposed npc and location — an NPC
 * run's one npc among them — is accepted or rejected. Such a job is over: the
 * server deletes it in the write that settled it.
 */
export function isGeneratorJobSettled(job: JobState): boolean {
  // A part still pending, running or failed keeps the job: the outline every
  // open part needs lives on it.
  if ((job.pipeline?.parts ?? []).some((part) => part.status !== "done")) return false;
  return (
    openSceneIds(job).size === 0 && openNpcIds(job).size === 0 && openLocationIds(job).size === 0
  );
}
