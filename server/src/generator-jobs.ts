// The generator job (ADR #31, `GeneratorJob` in @grimoire/shared) — a
// generation must not die with a browser-back gesture, which is what happens
// when the run is one synchronous request and the result lives only in client
// state.
//
// The model is deliberately small:
//
//   - ONE job per campaign — regardless of its KIND: a scene
//     run and an NPC run share the store and the 409 gate, `kind` only says
//     which result field is filled (and which UI mode to restore).
//   - `POST …/generator-jobs` (or an augment start on the resource it
//     augments) checks the request, then starts a job and answers 202 with
//     it; the run itself happens in the background.
//   - a finished job KEEPS its result until every proposal is accepted,
//     dropped or rejected, until it is discarded or until the next run
//     replaces it, so navigation/reload/restart of the tab costs nothing.
//   - review edits live in the job too — `sceneEdits` for the proposed
//     scenes and `npcEdits` for the proposed npcs, one change per id — so an
//     edited proposal survives the same way.
//
// THE JOB IS A DATABASE ROW (`generate_jobs`), not a Map.
// With the database as the single truth (ADR #13) the row is the obvious
// home, and it prevents the loss the job model was built for: a deploy or a
// container restart in the minute between a finished run and its accept
// would otherwise throw the generation away.
//
// Persistence changes nothing for the client, except that the answers stay
// truthful across a restart:
//
//   done/failed  survive a restart whole (result, npcResult, error body,
//                the DM's edits), so the review comes back and can be applied.
//   running      cannot survive: the provider call lived in the process that
//                is gone. The BOOT therefore turns every leftover `running`
//                row into a `failed` one whose error body carries a plain
//                German sentence — the app already renders exactly that field
//                for a failed run, so the DM reads "restart the job" instead
//                of watching a spinner that will never stop. That rewrite
//                lives in db/job-boot.ts (an import-cycle split, nothing
//                more) and runs from store/handle.ts.
//
// A failed run is stored as the ANSWER the synchronous endpoint would have
// given (status + JSON body), so nothing about the 422 semantics
// (rawReply, usage, validationErrors) changes for the client.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  GENERATOR_JOB_KINDS,
  isGeneratorJobSettled,
  npcEditSchema,
  openLocationIds,
  openNpcIds,
  openSceneIds,
  proposedNpcIds,
  sceneEditSchema,
} from "@grimoire/shared";
import type {
  GeneratorJob,
  GeneratorJobPart,
  GeneratorJobPatch,
  GeneratorJobPipeline,
  GeneratorJobReview,
  GeneratorJobError,
  GeneratorJobKind,
  GenerateNpcResult,
  GenerateResult,
  LocationAugmentResult,
  NpcAugmentResult,
  NpcChange,
  SceneAugmentResult,
  SceneChange,
} from "@grimoire/shared";
import { ApiError } from "./api-error";
import type { GrimoireDb } from "./db/client";
import { generateJobs } from "./db/schema";
import { runLocationAugment } from "./location-augment";
import { runNpcAugment } from "./npc-augment";
import { runSceneAugment } from "./scene-augment";
import { capRawReply, runGenerateNpc } from "./generator";
import {
  replanStoredRun,
  runPart,
  runScenePipeline,
  type PartOutcome,
  type PartUsage,
  type PipelineSink,
  type RunOutline,
} from "./generate-pipeline";
import type { LLMProvider } from "./llm-provider";
import type { SceneRunStart } from "./store/chapters";
import { getDb } from "./store/handle";
import { revConflict } from "./store/shared";

/** Server-side job record: the wire shape plus what only the server keeps. */
export interface Job {
  id: string;
  campaign: string;
  /** Scene run or NPC run — still one job per campaign. */
  kind: GeneratorJobKind;
  /** Target chapter; only a scene run has one. */
  chapter?: string;
  /** Id of the scene a SCENE AUGMENT run works on. */
  scene?: string;
  /** Id of the npc an NPC AUGMENT run works on. */
  npc?: string;
  /** Id of the location a LOCATION AUGMENT run works on. */
  location?: string;
  status: "running" | "done" | "failed";
  result?: GenerateResult;
  npcResult?: GenerateNpcResult;
  sceneAugmentResult?: SceneAugmentResult;
  npcAugmentResult?: NpcAugmentResult;
  locationAugmentResult?: LocationAugmentResult;
  error?: GeneratorJobError;
  startedAt: string;
  finishedAt?: string;
  /** The DM's changes to the proposed scenes, by scene id. */
  sceneEdits: Record<string, SceneChange>;
  /** The DM's changes to the proposed npcs, by npc id. */
  npcEdits: Record<string, NpcChange>;
  /** The DM's review state — decisions, drops, written parts. */
  review: GeneratorJobReview;
  /** Optimistic-concurrency token of that review state. */
  rev: number;
  /**
   * The pipeline of a scene run: the internal outline, the parts
   * with their status, and the run's totals. `undefined` for the single-call
   * runs and for a row that carries no pipeline.
   */
  pipeline?: PipelineRecord;
  /** The run's source material — a per-part retry sends it again. */
  sourceText?: string;
  newChapter: boolean;
  /**
   * Title of the chapter a new-chapter run creates — stored when the run
   * STARTS, so the accept step does not depend on the browser still holding
   * it. Undefined for every other run and for a job that carries no title;
   * the accept then falls back to the chapter id as the title.
   */
  newChapterTitle?: string;
}

/**
 * What the `pipeline` column holds. The OUTLINE is stored but
 * never serialized: it is an internal step and is never shown to the DM.
 * A retry needs it, a restart needs it — the browser does not. The one field
 * of it that reaches the client is a new chapter's description, because that
 * becomes the chapter's text (`serializePipeline`).
 */
export interface PipelineRecord {
  outline?: RunOutline;
  parts: StoredPart[];
  totals: { inputTokens: number; outputTokens: number; calls: number };
  /**
   * Where the run's scenes are placed from in their chapter
   * (store/chapters.ts `sceneRunPos`). Absent until the FIRST scene accept
   * takes it, and never recomputed after that — the whole point is that a
   * later accept of an earlier scene still finds its place. Server-internal
   * like the outline, and on the row for the same reason: it has to outlast a
   * restart between two accepts.
   */
  sceneStart?: SceneRunStart;
}

/**
 * One part on the row: the wire shape, what it cost, and the raw reply of its
 * last failed attempt. The raw reply IS serialized per part (the shared type
 * declares it and the failed part's card shows it behind the same disclosure
 * the whole-run failure uses) — the job's error body still carries the last
 * failed one, which is where the app has read it, but that is
 * one reply for a run with many parts.
 */
export type StoredPart = GeneratorJobPart & { usage?: PartUsage; rawReply?: string };

/** An empty pipeline — a run whose outline has not come back yet. */
export function emptyPipeline(): PipelineRecord {
  return { parts: [], totals: { inputTokens: 0, outputTokens: 0, calls: 0 } };
}

/**
 * The client's half of the pipeline: the parts in outline order, the totals
 * and — for a new-chapter run — the chapter description the outline wrote,
 * which the review shows with the chapter the accept will create. Deliberately
 * NOT the outline itself — see PipelineRecord.
 */
function serializePipeline(pipeline: PipelineRecord): GeneratorJobPipeline {
  const chapterDescription = pipeline.outline?.chapterDescription;
  return {
    ...(chapterDescription === undefined ? {} : { chapterDescription }),
    parts: pipeline.parts.map((part) => ({
      key: part.key,
      kind: part.kind,
      id: part.id,
      title: part.title,
      status: part.status,
      ...(part.error === undefined ? {} : { error: part.error }),
      ...(part.validationErrors === undefined
        ? {}
        : { validationErrors: part.validationErrors }),
      // Capped again on the way out: what a provider sent is already capped
      // by `capRawReply`, but a row written by an older deploy (or a
      // hand-edited database) must not be able to put a megabyte into every
      // poll of the job.
      ...(part.rawReply === undefined ? {} : { rawReply: capRawReply(part.rawReply) }),
    })),
    totals: pipeline.totals,
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Shape a thrown pipeline error the way api.ts's onError would have: an
 * ApiError keeps its status and `{ error, ...extra }` body (that is where
 * rawReply/usage/validationErrors live), anything else is a real 500 and is
 * logged like an unexpected error, never swallowed.
 */
function shapeError(err: unknown): GeneratorJobError {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.message, ...err.extra } };
  }
  console.error(err);
  return { status: 500, body: { error: "internal server error" } };
}

/** The wire shape. */
export function serializeJob(job: Job): GeneratorJob {
  return {
    id: job.id,
    kind: job.kind,
    ...(job.chapter === undefined ? {} : { chapter: job.chapter }),
    ...(job.scene === undefined ? {} : { scene: job.scene }),
    ...(job.npc === undefined ? {} : { npc: job.npc }),
    ...(job.location === undefined ? {} : { location: job.location }),
    status: job.status,
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.result === undefined ? {} : { result: job.result }),
    ...(job.npcResult === undefined ? {} : { npcResult: job.npcResult }),
    ...(job.sceneAugmentResult === undefined
      ? {}
      : { sceneAugmentResult: job.sceneAugmentResult }),
    ...(job.npcAugmentResult === undefined ? {} : { npcAugmentResult: job.npcAugmentResult }),
    ...(job.locationAugmentResult === undefined
      ? {}
      : { locationAugmentResult: job.locationAugmentResult }),
    ...(job.error === undefined ? {} : { error: job.error }),
    sceneEdits: job.sceneEdits,
    npcEdits: job.npcEdits,
    review: job.review,
    rev: job.rev,
    ...(job.pipeline === undefined ? {} : { pipeline: serializePipeline(job.pipeline) }),
  };
}

// --- row <-> job -------------------------------------------------------------

type JobRow = typeof generateJobs.$inferSelect;

/**
 * Parse one of the job's JSON payload columns. A column that cannot be parsed
 * degrades to "absent" instead of failing the request: the row is a cache of
 * a run, and an unreadable result must not make the job unreachable — the DM
 * can still see it, discard it and start again.
 *
 * "Can still discard it" is only true because `toJob` turns such a row into a
 * FAILED job (see UNREADABLE_PAYLOAD_MESSAGE): the review blocks and the
 * "Verwerfen" button of a done job hang off result/npcResult, so a done row
 * with no readable payload would render as a dead end with no way out.
 */
function unpackPayload<T>(value: string | null): T | undefined {
  if (value === null || value === "") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Parse the scene-edits column: one `SceneChange` per scene id, each checked
 * against the scene's schema. Like every other payload here it DEGRADES — a
 * value that is not a change is dropped rather than making the job
 * unreachable.
 */
function unpackSceneEdits(value: string): Record<string, SceneChange> {
  const edits: Record<string, SceneChange> = {};
  const parsed = unpackPayload<Record<string, unknown>>(value);
  if (parsed === undefined || parsed === null || typeof parsed !== "object") return edits;
  for (const [id, raw] of Object.entries(parsed)) {
    const change = sceneEditSchema.safeParse(raw);
    if (change.success) edits[id] = change.data;
  }
  return edits;
}

/**
 * Parse the npc-edits column: one `NpcChange` per npc id, each checked
 * against the npc's schema. Like every other payload here it DEGRADES — a
 * value that is not a change is dropped rather than making the job
 * unreachable.
 */
function unpackNpcEdits(value: string): Record<string, NpcChange> {
  const edits: Record<string, NpcChange> = {};
  const parsed = unpackPayload<Record<string, unknown>>(value);
  if (parsed === undefined || parsed === null || typeof parsed !== "object") return edits;
  for (const [id, raw] of Object.entries(parsed)) {
    const change = npcEditSchema.safeParse(raw);
    if (change.success) edits[id] = change.data;
  }
  return edits;
}

/** The review state of a job that has not been touched yet. */
export function emptyReview(): GeneratorJobReview {
  return {
    droppedScenes: [],
    fields: {},
    blocks: {},
    writtenScenes: [],
    npcs: {},
    writtenNpcs: [],
    locations: {},
    writtenLocations: [],
  };
}

function stringRecord<T>(value: unknown, pick: (v: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const kept = pick(raw);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/**
 * Parse the review column. Like every other payload here it DEGRADES: a
 * column that cannot be read (a hand-edited database, a truncated write)
 * becomes "nothing decided yet" instead of making the job unreachable — the
 * decisions are cheap to redo, the generation is not.
 */
function unpackReview(value: string): GeneratorJobReview {
  const parsed = unpackPayload<Record<string, unknown>>(value);
  if (parsed === undefined) return emptyReview();
  return {
    droppedScenes: stringList(parsed.droppedScenes),
    fields: stringRecord(parsed.fields, (v) => (typeof v === "boolean" ? v : undefined)),
    blocks: stringRecord(parsed.blocks, (v) => (typeof v === "boolean" ? v : undefined)),
    writtenScenes: stringList(parsed.writtenScenes),
    npcs: stringRecord(parsed.npcs, (v) => (v === "accepted" || v === "rejected" ? v : undefined)),
    writtenNpcs: stringList(parsed.writtenNpcs),
    locations: stringRecord(parsed.locations, (v) =>
      v === "accepted" || v === "rejected" ? v : undefined,
    ),
    writtenLocations: stringList(parsed.writtenLocations),
  };
}

/** The strings of a stored list; anything else in it is dropped. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * What the DM reads when a finished job's payload column is unreadable (a
 * truncated write, a hand-edited database). The wording is the one the
 * failure block already renders, and it names the only way forward.
 */
export const UNREADABLE_PAYLOAD_MESSAGE =
  "Das Ergebnis dieses Durchlaufs ist nicht mehr lesbar. Verwirf den Job und starte ihn neu.";

/** The kind of a stored job; anything unknown reads as a scene run. */
function jobKind(value: string): GeneratorJobKind {
  return (GENERATOR_JOB_KINDS as readonly string[]).includes(value)
    ? (value as GeneratorJobKind)
    : "scene";
}

function toJob(row: JobRow): Job {
  let status: Job["status"] =
    row.status === "done" || row.status === "failed" ? row.status : "running";
  const kind = jobKind(row.kind);
  const result = unpackPayload<GenerateResult>(row.result);
  const npcResult = unpackPayload<GenerateNpcResult>(row.npcResult);
  // One column holds the proposal of either augment run; the kind says which.
  const proposal = unpackPayload<unknown>(row.augmentResult);
  const sceneAugmentResult =
    kind === "scene-augment" ? (proposal as SceneAugmentResult | undefined) : undefined;
  const npcAugmentResult =
    kind === "npc-augment" ? (proposal as NpcAugmentResult | undefined) : undefined;
  const locationAugmentResult =
    kind === "location-augment" ? (proposal as LocationAugmentResult | undefined) : undefined;
  let error = unpackPayload<GeneratorJobError>(row.error);
  const pipeline = unpackPipeline(row.pipeline);

  // A finished job with nothing readable to show is degraded to `failed` with
  // an error body: `done` without a result would render review blocks that
  // are gated on it — no proposals, no "Verwerfen", nothing the DM can do — and
  // `failed` without a body would render an empty failure. As a failed job
  // with a message the existing block appears, and discarding works.
  const nothingToShow =
    result === undefined &&
    npcResult === undefined &&
    sceneAugmentResult === undefined &&
    npcAugmentResult === undefined &&
    locationAugmentResult === undefined;
  if ((status === "done" && nothingToShow) || (status === "failed" && error === undefined)) {
    status = "failed";
    error = { status: 500, body: { error: UNREADABLE_PAYLOAD_MESSAGE } };
  }

  return {
    id: row.id,
    campaign: row.campaignId,
    kind,
    ...(row.chapter === null ? {} : { chapter: row.chapter }),
    ...(row.sceneId === null ? {} : { scene: row.sceneId }),
    ...(row.npcId === null ? {} : { npc: row.npcId }),
    ...(row.locationId === null ? {} : { location: row.locationId }),
    status,
    startedAt: row.startedAt,
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
    ...(result === undefined ? {} : { result }),
    ...(npcResult === undefined ? {} : { npcResult }),
    ...(sceneAugmentResult === undefined ? {} : { sceneAugmentResult }),
    ...(npcAugmentResult === undefined ? {} : { npcAugmentResult }),
    ...(locationAugmentResult === undefined ? {} : { locationAugmentResult }),
    ...(error === undefined ? {} : { error }),
    sceneEdits: unpackSceneEdits(row.sceneEdits),
    npcEdits: unpackNpcEdits(row.npcEdits),
    review: unpackReview(row.review),
    rev: row.rev,
    ...(pipeline === undefined ? {} : { pipeline }),
    ...(row.sourceText === null ? {} : { sourceText: row.sourceText }),
    newChapter: row.newChapter === 1,
    ...(row.newChapterTitle === null || row.newChapterTitle === undefined
      ? {}
      : { newChapterTitle: row.newChapterTitle }),
  };
}

/**
 * Parse the pipeline column. Degrades like every other payload here: a column
 * that cannot be read becomes "this run has no parts", which renders as the
 * earlier review of whatever result is stored instead of making the job
 * unreachable.
 */
function unpackPipeline(value: string): PipelineRecord | undefined {
  const parsed = unpackPayload<Record<string, unknown>>(value);
  if (parsed === undefined) return undefined;
  const rawParts = Array.isArray(parsed.parts) ? parsed.parts : [];
  const parts: StoredPart[] = [];
  for (const item of rawParts) {
    if (item === null || typeof item !== "object") continue;
    const part = item as Record<string, unknown>;
    if (typeof part.key !== "string" || typeof part.id !== "string") continue;
    const kind = part.kind;
    if (kind !== "scene" && kind !== "npc" && kind !== "location") continue;
    const status = part.status;
    parts.push({
      key: part.key,
      kind,
      id: part.id,
      title: typeof part.title === "string" ? part.title : part.id,
      status:
        status === "pending" || status === "running" || status === "done" || status === "failed"
          ? status
          : "pending",
      ...(typeof part.error === "string" ? { error: part.error } : {}),
      ...(Array.isArray(part.validationErrors) &&
      part.validationErrors.every((e) => typeof e === "string")
        ? { validationErrors: part.validationErrors as string[] }
        : {}),
      ...(typeof part.rawReply === "string" ? { rawReply: part.rawReply } : {}),
    });
  }
  if (parts.length === 0 && parsed.outline === undefined) return undefined;
  const totals = (parsed.totals ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const sceneStart = unpackSceneStart(parsed.sceneStart);
  return {
    ...(parsed.outline === undefined ? {} : { outline: parsed.outline as RunOutline }),
    parts,
    totals: {
      inputTokens: num(totals.inputTokens),
      outputTokens: num(totals.outputTokens),
      calls: num(totals.calls),
    },
    ...(sceneStart === undefined ? {} : { sceneStart }),
  };
}

/**
 * The stored start of a run's scenes, or undefined when there is none or it
 * cannot be read. An unreadable one degrades to "not taken yet": the next
 * accept takes a fresh one at the chapter's end, which is where a scene went
 * before there was a start at all.
 */
function unpackSceneStart(value: unknown): SceneRunStart | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { pos, sceneOrderRev } = value as Record<string, unknown>;
  if (!Number.isInteger(pos) || !Number.isInteger(sceneOrderRev)) return undefined;
  return { pos: pos as number, sceneOrderRev: sceneOrderRev as number };
}

function jobRow(db: GrimoireDb, campaign: string): JobRow | undefined {
  return db.select().from(generateJobs).where(eq(generateJobs.campaignId, campaign)).all()[0];
}

// --- reads -------------------------------------------------------------------

/** The campaign's job, or undefined when there is none. */
export async function getJob(campaign: string): Promise<Job | undefined> {
  const db = await getDb();
  const row = jobRow(db, campaign);
  return row === undefined ? undefined : toJob(row);
}

// --- start -------------------------------------------------------------------

/**
 * What a run needs, per kind. One union instead of two start
 * functions: the 409 gate ("one generator job per campaign, whatever its
 * kind") must exist exactly once.
 */
export type JobInput = { campaign: string; provider: LLMProvider } & (
  | {
      kind: "scene";
      chapter: string;
      sourceText: string;
      newChapter: boolean;
      /** Title for the chapter a `newChapter` run creates. */
      newChapterTitle?: string;
    }
  | { kind: "npc"; sourceText: string; npcId?: string }
  // A scene augment run names a scene that EXISTS by its id. At least one of
  // sourceText/instruction is there — the route enforces that before a job
  // is created, and the run asserts it again.
  | { kind: "scene-augment"; scene: string; sourceText: string; instruction: string }
  // An npc augment run names the npc by its id, under the same rule.
  | { kind: "npc-augment"; npc: string; sourceText: string; instruction: string }
  // A location augment run names the location by its id, under the same rule.
  | { kind: "location-augment"; location: string; sourceText: string; instruction: string }
);

/**
 * Start a run in the background. One job per campaign: while one is RUNNING
 * a second start is a 409 carrying the running job (the app adopts it
 * instead of erroring). A finished job — done or failed — is simply replaced;
 * the DM asked for a new run.
 *
 * The gate and the row swap happen in ONE transaction, so two starts that
 * arrive together cannot both win: the second finds the first row and gets
 * its 409, and the table holds at most one row per campaign at all times.
 *
 * The provider is passed in because the start resolves it up front, so
 * "no provider configured" stays a synchronous 503 instead of becoming a
 * failed job.
 */
export async function startJob(input: JobInput): Promise<Job> {
  const db = await getDb();
  const job: Job = {
    id: randomUUID(),
    campaign: input.campaign,
    kind: input.kind,
    ...(input.kind === "scene" ? { chapter: input.chapter } : {}),
    ...(input.kind === "scene-augment" ? { scene: input.scene } : {}),
    ...(input.kind === "npc-augment" ? { npc: input.npc } : {}),
    ...(input.kind === "location-augment" ? { location: input.location } : {}),
    status: "running",
    startedAt: timestamp(),
    sceneEdits: {},
    npcEdits: {},
    review: emptyReview(),
    rev: 0,
    ...(input.kind === "scene"
      ? { sourceText: input.sourceText, pipeline: emptyPipeline() }
      : {}),
    newChapter: input.kind === "scene" && input.newChapter,
    ...(input.kind === "scene" && input.newChapterTitle !== undefined
      ? { newChapterTitle: input.newChapterTitle }
      : {}),
  };

  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const running = jobRow(tx, input.campaign);
    if (running !== undefined && running.status === "running") {
      throw new ApiError(409, "a generator job is already running for this campaign", {
        generatorJob: serializeJob(toJob(running)),
      });
    }
    // Replace rather than update: a new run is a new job with a new id, and
    // "at most one row per campaign" is what makes every read a single
    // lookup instead of an ordering question.
    tx.delete(generateJobs).where(eq(generateJobs.campaignId, input.campaign)).run();
    tx.insert(generateJobs)
      .values({
        id: job.id,
        campaignId: job.campaign,
        kind: job.kind,
        chapter: job.chapter ?? null,
        sceneId: job.scene ?? null,
        npcId: job.npc ?? null,
        locationId: job.location ?? null,
        status: "running",
        startedAt: job.startedAt,
        sceneEdits: "{}",
        npcEdits: "{}",
        review: "{}",
        rev: 0,
        pipeline: input.kind === "scene" ? JSON.stringify(emptyPipeline()) : "{}",
        sourceText: input.kind === "scene" ? input.sourceText : null,
        newChapter: input.kind === "scene" && input.newChapter ? 1 : 0,
        newChapterTitle: input.kind === "scene" ? (input.newChapterTitle ?? null) : null,
      })
      .run();
  });

  // Fire and forget — but never unhandled: the runner catches EVERYTHING and
  // turns it into a failed job.
  void (async () => {
    try {
      if (input.kind === "scene-augment") {
        const proposal = await runSceneAugment(
          input.campaign,
          input.scene,
          { sourceText: input.sourceText, instruction: input.instruction },
          () => input.provider,
        );
        await finish(job, { status: "done", augmentResult: JSON.stringify(proposal) });
        return;
      }
      if (input.kind === "npc-augment") {
        const proposal = await runNpcAugment(
          input.campaign,
          input.npc,
          { sourceText: input.sourceText, instruction: input.instruction },
          () => input.provider,
        );
        await finish(job, { status: "done", augmentResult: JSON.stringify(proposal) });
        return;
      }
      if (input.kind === "location-augment") {
        const proposal = await runLocationAugment(
          input.campaign,
          input.location,
          { sourceText: input.sourceText, instruction: input.instruction },
          () => input.provider,
        );
        await finish(job, { status: "done", augmentResult: JSON.stringify(proposal) });
        return;
      }
      if (input.kind === "npc") {
        const npcResult = await runGenerateNpc(
          input.campaign,
          input.sourceText,
          input.npcId,
          () => input.provider,
        );
        await finish(job, { status: "done", npcResult: JSON.stringify(npcResult) });
        return;
      }
      // A scene run is a PIPELINE: the outline call, then
      // one call per scene, per new npc and per new location, three at a
      // time. The sink
      // writes every step onto this job's row — which is what makes a
      // finished part reviewable while its siblings are still running, and
      // what makes it survive a restart.
      await runScenePipeline({
        campaign: input.campaign,
        chapter: input.chapter,
        sourceText: input.sourceText,
        newChapter: input.newChapter,
        sink: await jobSink(job.campaign, job.id),
        getProvider: () => input.provider,
      });
    } catch (err) {
      // The last line of defense must not throw itself: `finish` touches the
      // database, and a database that is gone (a shutdown mid-run) would turn
      // the failure path into an unhandled rejection — killing the process on
      // Node's default. Logged instead; the row stays `running` and the next
      // boot turns it into a failed job, which is the same answer.
      try {
        await finish(job, { status: "failed", error: JSON.stringify(shapeError(err)) });
      } catch (finishErr) {
        console.error("could not record the failed generator job", finishErr);
      }
    }
  })();

  return job;
}

/**
 * Write the outcome — but only onto the job's OWN row, and only while that
 * row is still `running`. A run the DM discarded (its row is gone), one
 * replaced by a new start (a different id) or one a boot already declared
 * failed must not come back to life when its provider call finally returns;
 * the WHERE clause is that guarantee — it simply matches nothing.
 */
async function finish(
  job: Job,
  outcome: {
    status: "done" | "failed";
    result?: string;
    npcResult?: string;
    augmentResult?: string;
    error?: string;
  },
): Promise<void> {
  const db = await getDb();
  db.update(generateJobs)
    .set({
      status: outcome.status,
      finishedAt: timestamp(),
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      ...(outcome.npcResult === undefined ? {} : { npcResult: outcome.npcResult }),
      ...(outcome.augmentResult === undefined ? {} : { augmentResult: outcome.augmentResult }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    })
    .where(
      and(
        eq(generateJobs.id, job.id),
        eq(generateJobs.campaignId, job.campaign),
        eq(generateJobs.status, "running"),
      ),
    )
    .run();
}

// --- the pipeline sink -------------------------------------------------------
//
// Every step of a pipelined run is WRITTEN DOWN before the next one starts:
// the outline's part list, each part going `running`, each part's result or
// error, and the run's running totals. Two properties hang off that, and
// neither is true of state kept in the process:
//
//   * a part that is `done` is in `result` and therefore reviewable and
//     acceptable while its siblings are still going,
//   * a restart keeps the done parts and fails only what was in flight
//     (db/job-boot.ts).
//
// `cancelled()` asks the DATABASE, not a flag: the row is the only thing that
// knows whether this run is still the campaign's run. Discarding deletes the
// row and a new start replaces it — both make every open part of the old run
// stop at its next checkpoint, and neither needs a message to reach the
// worker.

/**
 * Read this job's row, or undefined once it is gone, was replaced, or is no
 * longer `running`.
 *
 * The status check is the same guarantee `finish` gives: a run the DM
 * discarded, one replaced by a new start and one a BOOT already declared
 * failed must not come back to life when its provider call finally returns.
 * A retry therefore puts the row back to `running` itself (see
 * `retryJobPart`) before the worker's first checkpoint.
 */
function ownRow(db: GrimoireDb, campaign: string, jobId: string): JobRow | undefined {
  const row = jobRow(db, campaign);
  if (row === undefined || row.id !== jobId) return undefined;
  return row.status === "running" ? row : undefined;
}

/** Merge a part's outcome into the job's result payload. */
function mergeOutcome(result: GenerateResult, outcome: PartOutcome): GenerateResult {
  const scenes = [...result.scenes];
  const npcs = [...result.npcs];
  const locations = [...result.locations];
  // Deduped by id: a retried part replaces its own scene, npc or location
  // rather than proposing it twice.
  if (outcome.scene !== undefined) {
    const scene = outcome.scene;
    const at = scenes.findIndex((s) => s.id === scene.id);
    if (at === -1) scenes.push(scene);
    else scenes[at] = scene;
  }
  if (outcome.npc !== undefined) {
    const npc = outcome.npc;
    const at = npcs.findIndex((n) => n.id === npc.id);
    if (at === -1) npcs.push(npc);
    else npcs[at] = npc;
  }
  if (outcome.location !== undefined) {
    const location = outcome.location;
    const at = locations.findIndex((l) => l.id === location.id);
    if (at === -1) locations.push(location);
    else locations[at] = location;
  }
  const warnings = [...result.warnings];
  for (const warning of outcome.warnings) if (!warnings.includes(warning)) warnings.push(warning);
  const namingHints = [...(result.namingHints ?? []), ...outcome.namingHints];
  return {
    scenes,
    npcs,
    locations,
    warnings,
    ...(namingHints.length === 0 ? {} : { namingHints }),
  };
}

/**
 * The outline NUMBER of each scene of a run, by scene id: its index among the
 * scene parts, in outline order. A part that failed or was dropped keeps its
 * number, and a retry does not change it — the parts list is the outline's
 * and never reshuffled.
 */
export function outlineSceneNumbers(parts: readonly StoredPart[]): Map<string, number> {
  return new Map(parts.filter((p) => p.kind === "scene").map((p, i) => [p.id, i]));
}

/**
 * Order the result the way the OUTLINE ordered the parts: the review shows
 * the parts in outline order, and parts finish out of order because three of
 * them run at once.
 */
function inPartOrder(result: GenerateResult, parts: readonly StoredPart[]): GenerateResult {
  const sceneRank = outlineSceneNumbers(parts);
  const npcRank = new Map(parts.filter((p) => p.kind === "npc").map((p, i) => [p.id, i]));
  const locationRank = new Map(
    parts.filter((p) => p.kind === "location").map((p, i) => [p.id, i]),
  );
  const rank = (map: Map<string, number>, key: string): number => map.get(key) ?? Number.MAX_SAFE_INTEGER;
  return {
    ...result,
    scenes: [...result.scenes].sort((a, b) => rank(sceneRank, a.id) - rank(sceneRank, b.id)),
    npcs: [...result.npcs].sort((a, b) => rank(npcRank, a.id) - rank(npcRank, b.id)),
    locations: [...result.locations].sort(
      (a, b) => rank(locationRank, a.id) - rank(locationRank, b.id),
    ),
  };
}

/** The run is over when no part is waiting or in flight any more. */
export function partsSettled(pipeline: PipelineRecord): boolean {
  return !pipeline.parts.some((p) => p.status === "pending" || p.status === "running");
}

/**
 * What a run whose every part failed answers. The shape is the 422 the
 * synchronous endpoint would have given, because that is
 * what the app's failure block renders — with the per-part messages as the
 * error list, since that is what went wrong.
 */
function allPartsFailed(pipeline: PipelineRecord): GeneratorJobError {
  const errors: string[] = [];
  let lastRawReply: string | undefined;
  for (const part of pipeline.parts) {
    for (const message of part.validationErrors ?? []) errors.push(message);
    if ((part.validationErrors ?? []).length === 0 && part.error !== undefined) {
      errors.push(`${part.key}: ${part.error}`);
    }
    if (part.rawReply !== undefined) lastRawReply = part.rawReply;
  }
  return {
    status: 422,
    body: {
      code: "llm_invalid",
      error: "generation failed mechanical validation after retries",
      validationErrors: errors,
      ...(pipeline.totals.inputTokens + pipeline.totals.outputTokens === 0
        ? {}
        : {
            usage: {
              inputTokens: pipeline.totals.inputTokens,
              outputTokens: pipeline.totals.outputTokens,
              attempts: pipeline.totals.calls,
            },
          }),
      ...(lastRawReply === undefined ? {} : { rawReply: lastRawReply }),
    },
  };
}

/**
 * Write one pipeline step onto the job's own row. Everything the sink does
 * goes through here, so "the row still belongs to this run" is checked in
 * exactly one place — and a step for a run that was discarded or replaced is
 * dropped instead of resurrecting it (the rule `finish` follows).
 */
async function updatePipeline(
  campaign: string,
  jobId: string,
  change: (pipeline: PipelineRecord, result: GenerateResult) => { result?: GenerateResult },
): Promise<void> {
  const db = await getDb();
  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const row = ownRow(tx, campaign, jobId);
    if (row === undefined) return;
    const pipeline = unpackPipeline(row.pipeline) ?? emptyPipeline();
    const stored = unpackPayload<GenerateResult>(row.result);
    const base: GenerateResult = stored ?? { scenes: [], npcs: [], locations: [], warnings: [] };
    const outcome = change(pipeline, base);
    const result = inPartOrder(outcome.result ?? base, pipeline.parts);
    const settled = partsSettled(pipeline);
    const anyDone = pipeline.parts.some((p) => p.status === "done");
    tx.update(generateJobs)
      .set({
        pipeline: JSON.stringify(pipeline),
        // The result's `usage` keeps its old meaning: present only when the
        // endpoint actually reported tokens (a local endpoint reports none,
        // and claiming 0 would be a lie). The CALL COUNT always lives on the
        // pipeline totals, which is what the review header reads.
        result: JSON.stringify({
          ...result,
          ...(pipeline.totals.inputTokens + pipeline.totals.outputTokens === 0
            ? {}
            : {
                usage: {
                  inputTokens: pipeline.totals.inputTokens,
                  outputTokens: pipeline.totals.outputTokens,
                  attempts: pipeline.totals.calls,
                },
              }),
        }),
        // While parts are open the job stays `running`, so the app keeps
        // polling and the review keeps filling up. Settled means finished:
        // `done` as soon as ONE part produced something (the failed ones are
        // retryable, the finished ones acceptable), `failed` only when the
        // whole run produced nothing at all.
        status: settled ? (anyDone ? "done" : "failed") : "running",
        ...(settled ? { finishedAt: timestamp() } : {}),
        ...(settled && !anyDone ? { error: JSON.stringify(allPartsFailed(pipeline)) } : {}),
      })
      .where(eq(generateJobs.id, row.id))
      .run();
  });
}

/** Add a part's usage to the run's totals. */
function addUsage(pipeline: PipelineRecord, usage: PartUsage): void {
  pipeline.totals = {
    inputTokens: pipeline.totals.inputTokens + usage.inputTokens,
    outputTokens: pipeline.totals.outputTokens + usage.outputTokens,
    calls: pipeline.totals.calls + usage.calls,
  };
}

function findPart(pipeline: PipelineRecord, key: string): StoredPart | undefined {
  return pipeline.parts.find((p) => p.key === key);
}

/** The sink a run (or a single-part retry) reports into. */
export async function jobSink(campaign: string, jobId: string): Promise<PipelineSink> {
  const db = await getDb();
  return {
    async outlineReady(outline, parts, usage) {
      await updatePipeline(campaign, jobId, (pipeline, result) => {
        pipeline.outline = outline;
        pipeline.parts = parts.map((part) => ({ ...part }));
        addUsage(pipeline, usage);
        // The outline's own warnings are the run's warnings: it is the step
        // that read the whole source text, so a warning about what the
        // source material does not contain can only come from here.
        const warnings = outline.warnings.filter((w) => !result.warnings.includes(w));
        return { result: { ...result, warnings: [...result.warnings, ...warnings] } };
      });
    },
    async partRunning(key) {
      await updatePipeline(campaign, jobId, (pipeline) => {
        const part = findPart(pipeline, key);
        if (part !== undefined) {
          part.status = "running";
          delete part.error;
          delete part.validationErrors;
          // The raw reply belongs to the attempt that failed; a part that is
          // being written again has none, and leaving the old one there would
          // put the raw-reply block under a running part (and into the next
          // success, where nothing came back wrong at all).
          delete part.rawReply;
        }
        return {};
      });
    },
    async partDone(key, outcome, usage) {
      await updatePipeline(campaign, jobId, (pipeline, result) => {
        const part = findPart(pipeline, key);
        if (part !== undefined) {
          part.status = "done";
          delete part.error;
          delete part.validationErrors;
          delete part.rawReply;
          part.usage = usage;
        }
        addUsage(pipeline, usage);
        return { result: mergeOutcome(result, outcome) };
      });
    },
    async partFailed(key, failure, usage) {
      await updatePipeline(campaign, jobId, (pipeline) => {
        const part = findPart(pipeline, key);
        if (part !== undefined) {
          part.status = "failed";
          part.error = failure.error;
          if (failure.validationErrors !== undefined) {
            part.validationErrors = failure.validationErrors;
          }
          if (failure.rawReply !== undefined) part.rawReply = failure.rawReply;
          part.usage = usage;
        }
        addUsage(pipeline, usage);
        return {};
      });
    },
    cancelled() {
      return ownRow(db, campaign, jobId) === undefined;
    },
  };
}

// --- retry per part ----------------------------------------------------------

/**
 * Restart ONE part of a run. Only that part: the outline stays, the finished
 * parts stay reviewable, and the retried part goes back through exactly the
 * call it failed on (`runPart`) — same prompt, same excerpt, same validation.
 *
 * 404 when the campaign has no job, when `jobId` names a different one or
 * when the run has no such part; 409 when the part is already running, still
 * PENDING (the run's queue owns it — it has not had its turn yet) or already done (a
 * double click is not a reason to spend tokens twice).
 *
 * The revive is ONE TRANSACTION over a re-read row, and that is not a detail:
 * `replanStoredRun` awaits the campaign context, and while it does a sibling
 * part of the very same run can report `partDone`. Writing back the pipeline
 * this function read BEFORE that await would clobber the sibling's status
 * (flipping it from `done` back to `running`) and with it the run's ability to
 * ever settle. So the transaction re-reads the row, mutates ONLY the addressed
 * part, and re-checks every guard against what it found — the losing racer
 * gets its 409 instead of a lost write.
 */
export async function retryJobPart(
  campaign: string,
  jobId: string,
  key: string,
  provider: LLMProvider,
): Promise<Job> {
  const db = await getDb();
  // Not `ownRow`: the job whose part is being retried is exactly one that is
  // NOT running any more.
  const preread = jobRow(db, campaign);
  if (preread === undefined || preread.id !== jobId) {
    throw noJob();
  }
  const prejob = toJob(preread);
  // The guards run TWICE: here, so a 404/409 costs no context read at all,
  // and again inside the transaction, which is where they are binding.
  assertRetryable(prejob, key);
  const chapter = prejob.chapter!;
  const plan = await replanStoredRun({
    campaign,
    chapter,
    sourceText: prejob.sourceText ?? "",
    newChapter: prejob.newChapter,
    outline: prejob.pipeline!.outline!,
  });

  // Back to `running` BEFORE the answer — every sink write refuses a row that
  // is not running (see ownRow) and this is the one place that revives one. A
  // poll arriving between the 202 and the provider call then reads the job as
  // running rather than as finished.
  const part = db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const row = jobRow(tx, campaign);
    if (row === undefined || row.id !== jobId) {
      throw noJob();
    }
    const job = toJob(row);
    const target = assertRetryable(job, key);
    const pipeline = job.pipeline!;
    const revived: PipelineRecord = {
      ...pipeline,
      parts: pipeline.parts.map((p) => {
        if (p.key !== key) return p;
        const { error: _error, validationErrors: _errors, rawReply: _raw, ...rest } = p;
        return { ...rest, status: "running" as const };
      }),
    };
    tx.update(generateJobs)
      .set({
        status: "running",
        pipeline: JSON.stringify(revived),
        error: null,
        // The run is open again, so it has no finish time: a `finishedAt`
        // left over from the settled run would outlive its own truth and
        // survive into the next settle only to be overwritten.
        finishedAt: null,
      })
      .where(eq(generateJobs.id, row.id))
      .run();
    return target;
  }) as StoredPart;

  const sink = await jobSink(campaign, jobId);
  void (async () => {
    try {
      await runPart(plan, { ...part, status: "pending" }, provider, sink);
    } catch (err) {
      console.error("could not record the retried part", err);
    }
  })();
  const after = await getJob(campaign);
  return after ?? prejob;
}

/**
 * May this part be retried? Answers with the part, throws the endpoint's
 * 404/409 otherwise. Called once before the context read and once INSIDE the
 * revive transaction — the second call is the binding one, because the first
 * one's row is already stale by the time the plan is ready.
 */
function assertRetryable(job: Job, key: string): StoredPart {
  const pipeline = job.pipeline;
  if (pipeline === undefined || pipeline.outline === undefined) {
    throw new ApiError(409, "this job has no pipeline parts to retry");
  }
  const part = findPart(pipeline, key);
  if (part === undefined) throw new ApiError(404, `unknown part: ${key}`);
  if (part.status === "running") throw new ApiError(409, "this part is already running");
  if (part.status === "done") throw new ApiError(409, "this part is already finished");
  // A PENDING part still belongs to the run's own queue: it has not had its
  // turn yet, and reviving it here would run it twice — once from the queue,
  // once from this call, both writing the same part.
  if (part.status === "pending") throw new ApiError(409, "this part has not run yet");
  if (job.chapter === undefined) throw new ApiError(409, "this job has no target chapter");
  return part;
}

// --- one job by its id --------------------------------------------------------

/** The 404 of a job that is not there. */
function noJob(): ApiError {
  return new ApiError(404, "no such generator job for this campaign");
}

/**
 * The campaign's job under its id, or the 404 — for a campaign without a job
 * and for an id that names a different one: a request for a run that was
 * replaced must not land on its successor.
 */
export async function requireJob(campaign: string, jobId: string): Promise<Job> {
  const job = await getJob(campaign);
  if (job === undefined || job.id !== jobId) throw noJob();
  return job;
}

/**
 * The 409 of a stale guard: `code: "rev_conflict"`, the current `rev` and the
 * job as it stands now under the name of its entity (ADR #31).
 */
export function jobConflict(job: Job): ApiError {
  return revConflict(job.rev, "the generator job changed", {
    generatorJob: serializeJob(job),
  });
}

// --- discard -----------------------------------------------------------------

/**
 * Discard the campaign's job, whatever its status: a running run is
 * abandoned and its result never lands (see `finish`). What an accept already
 * wrote stays — it is a row of the campaign, not part of the job. `rev` is
 * the guard the job was read with: a decision taken in another tab in between
 * is a 409 carrying the job as it stands, and nothing is deleted.
 */
export async function deleteJob(campaign: string, jobId: string, rev: number): Promise<void> {
  const db = await getDb();
  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const row = jobRow(tx, campaign);
    if (row === undefined || row.id !== jobId) throw noJob();
    if (row.rev !== rev) throw jobConflict(toJob(row));
    tx.delete(generateJobs).where(eq(generateJobs.id, row.id)).run();
  });
}

// Discarding the job an accept settles is NOT here: it belongs to the same
// transaction as the writes (`markWrittenInTx`). A separate "delete if
// current" call after the write would leave a window in which a crash kept a
// job whose proposals were already stored.

// --- review state ------------------------------------------------------------

/**
 * Store the review part of a `PATCH …/generator-jobs/:id` — the DM's changes
 * to a proposal and their decisions. A patch that also ACCEPTS goes through
 * `acceptJobParts` (./generator-job-accept.ts), which applies the same review
 * part inside its write.
 *
 * `rev` is the guard the client read: a second tab that decided something
 * first makes this a 409 carrying the job as it stands, and nothing is
 * written.
 */
export async function patchJobReview(
  campaign: string,
  jobId: string,
  patch: GeneratorJobPatch,
): Promise<Job> {
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const row = jobRow(tx, campaign);
    if (row === undefined || row.id !== jobId) throw noJob();
    const job = toJob(row);
    if (row.rev !== patch.rev) throw jobConflict(job);
    applyReviewPatch(job, patch);
    tx.update(generateJobs)
      .set({
        sceneEdits: JSON.stringify(job.sceneEdits),
        npcEdits: JSON.stringify(job.npcEdits),
        review: JSON.stringify(job.review),
        rev: row.rev + 1,
      })
      .where(eq(generateJobs.id, row.id))
      .run();
    return { ...job, rev: row.rev + 1 };
  }) as Job;
}

/**
 * A scene, npc or location id the run never produced is a client bug, not
 * state to store: a typo would grow a key nothing would ever read again.
 */
function assertKnownProposals(job: Job, patch: GeneratorJobPatch): void {
  const review = patch.review ?? {};
  const sceneIds = new Set((job.result?.scenes ?? []).map((scene) => scene.id));
  for (const id of [
    ...Object.keys(patch.sceneEdits ?? {}),
    ...(review.droppedScenes ?? []),
    ...(review.writtenScenes ?? []),
  ]) {
    if (!sceneIds.has(id)) throw new ApiError(400, `unknown scene: ${id}`);
  }
  const npcIds = new Set(proposedNpcIds(job));
  for (const id of [
    ...Object.keys(patch.npcEdits ?? {}),
    ...Object.keys(review.npcs ?? {}),
    ...(review.writtenNpcs ?? []),
  ]) {
    if (!npcIds.has(id)) throw new ApiError(400, `unknown npc: ${id}`);
  }
  const locationIds = new Set((job.result?.locations ?? []).map((location) => location.id));
  for (const id of [...Object.keys(review.locations ?? {}), ...(review.writtenLocations ?? [])]) {
    if (!locationIds.has(id)) throw new ApiError(400, `unknown location: ${id}`);
  }
}

/**
 * Merge the review part of a patch into a job in memory (the caller's
 * transaction writes the result). A change to a proposal merges field by
 * field onto the stored one, so a text edit keeps an earlier field edit; a
 * decision merges key by key, `null` taking it back. The accepted lists are
 * not merged here: only the write that accepts them adds to them.
 */
export function applyReviewPatch(job: Job, patch: GeneratorJobPatch): void {
  assertKnownProposals(job, patch);
  for (const [id, change] of Object.entries(patch.sceneEdits ?? {})) {
    job.sceneEdits[id] = { ...job.sceneEdits[id], ...change };
  }
  for (const [id, change] of Object.entries(patch.npcEdits ?? {})) {
    job.npcEdits[id] = { ...job.npcEdits[id], ...change };
  }
  const review = patch.review ?? {};
  for (const [id, decision] of Object.entries(review.npcs ?? {})) {
    // `null` is undecided — the review's third state, which is why an
    // undo has to be expressible and is not just a missing key.
    if (decision === null) delete job.review.npcs[id];
    else job.review.npcs[id] = decision;
  }
  for (const [id, decision] of Object.entries(review.locations ?? {})) {
    if (decision === null) delete job.review.locations[id];
    else job.review.locations[id] = decision;
  }
  if (review.droppedScenes !== undefined) {
    job.review.droppedScenes = [...new Set(review.droppedScenes)];
  }
  assignFlags(job.review.fields, review.fields);
  assignFlags(job.review.blocks, review.blocks);
}

/** Merge boolean decisions; `null` deletes the key. */
function assignFlags(into: Record<string, boolean>, patch?: Record<string, boolean | null>): void {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete into[key];
    else into[key] = value;
  }
}

/**
 * Record an accept on the job — called INSIDE the write transaction
 * (store/generated.ts `writeGenerated`), so the job and the rows it produced
 * can never disagree after a crash: either both landed or neither did.
 *
 * The row is re-read HERE, and the patch's guard is checked against it: a
 * job that MOVED or VANISHED since the accept planned throws, which rolls the
 * whole write back. The review part of the patch is applied to this row, and
 * the written proposals join the accepted lists.
 *
 * `sceneStart` is the start this accept TOOK — given only by the run's first
 * scene accept, and stored on the pipeline in the same commit as the scenes
 * it placed.
 *
 * Answers the job as this write leaves it. When nothing is left open the row
 * is deleted in the same commit, and the answer is the job as it ended.
 */
export function markWrittenInTx(
  tx: GrimoireDb,
  campaign: string,
  jobId: string,
  patch: GeneratorJobPatch,
  written: { scenes: readonly string[]; npcs: readonly string[]; locations: readonly string[] },
  sceneStart?: SceneRunStart,
): Job {
  const row = jobRow(tx, campaign);
  if (row === undefined || row.id !== jobId) throw noJob();
  const job = toJob(row);
  if (row.rev !== patch.rev) throw jobConflict(job);
  applyReviewPatch(job, patch);
  // Openness is recomputed from the row THIS transaction sees, never from
  // the caller's pre-read: a part that was dropped or rejected in between
  // must not be recorded as written.
  const openScenes = openSceneIds(job);
  const openNpcs = openNpcIds(job);
  const openLocations = openLocationIds(job);
  const stale =
    written.scenes.some((id) => !openScenes.has(id)) ||
    written.npcs.some((id) => !openNpcs.has(id)) ||
    written.locations.some((id) => !openLocations.has(id));
  if (stale) throw jobConflict(toJob(row));
  job.review.writtenScenes.push(...written.scenes);
  job.review.writtenNpcs.push(...written.npcs);
  job.review.writtenLocations.push(...written.locations);
  const next: Job = { ...job, rev: row.rev + 1 };
  if (isGeneratorJobSettled(job)) {
    tx.delete(generateJobs).where(eq(generateJobs.id, row.id)).run();
    return next;
  }
  tx.update(generateJobs)
    .set({
      sceneEdits: JSON.stringify(job.sceneEdits),
      npcEdits: JSON.stringify(job.npcEdits),
      review: JSON.stringify(job.review),
      rev: row.rev + 1,
      // Merged onto the stored column rather than re-serialized from the
      // parsed record, so nothing else the pipeline holds is rewritten here.
      ...(sceneStart === undefined
        ? {}
        : {
            pipeline: JSON.stringify({
              ...unpackPayload<Record<string, unknown>>(row.pipeline),
              sceneStart,
            }),
          }),
    })
    .where(eq(generateJobs.id, row.id))
    .run();
  return next;
}

/** Test-only: drop every job row. */
export async function clearJobsForTests(): Promise<void> {
  const db = await getDb();
  db.delete(generateJobs).run();
}
