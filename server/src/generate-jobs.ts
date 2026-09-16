// Background generate jobs — born from a production loss: a
// finished, good generation died with a browser-back gesture because the
// run was one synchronous request and the result lived only in client state.
//
// The model is deliberately small:
//
//   - ONE job per campaign — regardless of its KIND: a scene
//     run and an NPC run share the store and the 409 gate, `kind` only says
//     which result field is filled (and which UI mode to restore).
//   - POST /generate validates as before, then starts a job and answers 202;
//     the pipeline (./generator runGenerate) is untouched — same prompt, same
//     validation, same correction turns, same 422 shaping.
//   - a finished job KEEPS its result until it is applied, discarded or
//     replaced by the next run, so navigation/reload/restart of the tab
//     costs nothing.
//   - review edits live in the job too (draftEdits), so an edited draft
//     survives the same way.
//
// THE JOB IS A DATABASE ROW (`generate_jobs`), not a Map.
// Persistence was parked as a non-goal because the campaign files were
// the only truth and there was nowhere sensible to put a job; with the
// database as that truth (ADR #13) the row is the obvious home, and the loss
// it prevents is the same one the job model was built for: a deploy or a
// container restart in the minute between "fertig" and "Übernehmen" used to
// throw away a finished generation.
//
// What persistence changes for the client — nothing, except that the answers
// are now truthful across a restart:
//
//   done/failed  survive a restart whole (result, npcResult, error body,
//                draftEdits), so the review comes back and can be applied.
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
import type {
  AugmentResult,
  GenerateJob,
  GenerateJobPart,
  GenerateJobPipeline,
  GenerateJobReview,
  GenerateReviewDecision,
  GenerateJobError,
  GenerateJobKind,
  GenerateNpcResult,
  GenerateResult,
} from "@grimoire/shared";
import { ApiError } from "./api-error";
import { now } from "./clock";
import type { GrimoireDb } from "./db/client";
import { generateJobs } from "./db/schema";
import { runAugment } from "./generator-augment";
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
import { getDb } from "./store/handle";
import { RESERVED_SEGMENTS } from "./store/paths";

/** Server-side job record; `draftEdits` is a Map here, an object on the wire. */
interface Job {
  id: string;
  campaign: string;
  /** Scene run or NPC run — still one job per campaign. */
  kind: GenerateJobKind;
  /** Target chapter; only a scene run has one. */
  chapter?: string;
  /** Address of the entry an AUGMENT run works on. */
  target?: string;
  status: "running" | "done" | "failed";
  result?: GenerateResult;
  npcResult?: GenerateNpcResult;
  augmentResult?: AugmentResult;
  error?: GenerateJobError;
  startedAt: string;
  finishedAt?: string;
  draftEdits: Map<string, string>;
  /** The DM's review state — decisions, drops, written parts. */
  review: GenerateJobReview;
  /** Optimistic-concurrency token of that review state. */
  rev: number;
  /**
   * The pipeline of a scene run: the internal outline, the parts
   * with their status, and the run's totals. `undefined` for the single-call
   * runs and for a row written before this deploy.
   */
  pipeline?: PipelineRecord;
  /** The run's source material — a per-part retry sends it again. */
  sourceText?: string;
  newChapter: boolean;
  /**
   * Title of the chapter a „Neues Kapitel" run creates — stored when the run
   * STARTS, so the accept step no longer depends on the browser still holding
   * it. Undefined for every other run and for a job written before that
   * column existed; the accept then falls back to the chapter id as the
   * title.
   */
  newChapterTitle?: string;
}

/**
 * What the `pipeline` column holds. The OUTLINE is stored but
 * never serialized: it is an internal step and is never shown to the DM (PO,
 * 15.09.). A retry needs it, a restart needs it — the browser does not.
 */
export interface PipelineRecord {
  outline?: RunOutline;
  parts: StoredPart[];
  totals: { inputTokens: number; outputTokens: number; calls: number };
}

/**
 * One part on the row: the wire shape, what it cost, and the raw reply of its
 * last failed attempt. The raw reply IS serialized per part (the shared type
 * declares it and the failed part's card shows it behind the same disclosure
 * the whole-run failure uses) — the job's error body still carries the last
 * failed one, which is where the app has read it, but that is
 * one reply for a run with many parts.
 */
export type StoredPart = GenerateJobPart & { usage?: PartUsage; rawReply?: string };

/** An empty pipeline — a run whose outline has not come back yet. */
export function emptyPipeline(): PipelineRecord {
  return { parts: [], totals: { inputTokens: 0, outputTokens: 0, calls: 0 } };
}

/**
 * The client's half of the pipeline: the parts in outline order and the
 * totals. Deliberately NOT the outline — see PipelineRecord.
 */
function serializePipeline(pipeline: PipelineRecord): GenerateJobPipeline {
  return {
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
  return now().toISOString();
}

/**
 * Shape a thrown pipeline error the way api.ts's onError would have: an
 * ApiError keeps its status and `{ error, ...extra }` body (that is where
 * rawReply/usage/validationErrors live), anything else is a real 500 and is
 * logged like an unexpected error, never swallowed.
 */
function shapeError(err: unknown): GenerateJobError {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.message, ...err.extra } };
  }
  console.error(err);
  return { status: 500, body: { error: "internal server error" } };
}

/** The wire shape (Map -> plain object). */
export function serializeJob(job: Job): GenerateJob {
  return {
    id: job.id,
    campaign: job.campaign,
    kind: job.kind,
    ...(job.chapter === undefined ? {} : { chapter: job.chapter }),
    ...(job.target === undefined ? {} : { target: job.target }),
    status: job.status,
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.result === undefined ? {} : { result: job.result }),
    ...(job.npcResult === undefined ? {} : { npcResult: job.npcResult }),
    ...(job.augmentResult === undefined ? {} : { augmentResult: job.augmentResult }),
    ...(job.error === undefined ? {} : { error: job.error }),
    draftEdits: Object.fromEntries(job.draftEdits),
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

function unpackEdits(value: string): Map<string, string> {
  const edits = new Map<string, string>();
  const parsed = unpackPayload<Record<string, unknown>>(value);
  if (parsed === undefined) return edits;
  for (const [key, markdown] of Object.entries(parsed)) {
    if (typeof markdown === "string") edits.set(draftAddress(key), markdown);
  }
  return edits;
}

/** The review state of a job that has not been touched yet. */
export function emptyReview(): GenerateJobReview {
  return { entries: {}, dropped: [], fields: {}, blocks: {}, written: {} };
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
function unpackReview(value: string): GenerateJobReview {
  const parsed = unpackPayload<Record<string, unknown>>(value);
  if (parsed === undefined) return emptyReview();
  return {
    entries: stringRecord(parsed.entries, (v) =>
      v === "accepted" || v === "rejected" ? v : undefined,
    ),
    dropped: Array.isArray(parsed.dropped)
      ? parsed.dropped.filter((v): v is string => typeof v === "string").map(draftAddress)
      : [],
    fields: stringRecord(parsed.fields, (v) => (typeof v === "boolean" ? v : undefined)),
    blocks: stringRecord(parsed.blocks, (v) => (typeof v === "boolean" ? v : undefined)),
    // `written` is keyed by the DRAFT PATH, so it is normalized like every
    // other path key of a persisted row (see draftAddress). Its VALUES are
    // the addresses the parts actually landed at — already current, and a
    // scene address legitimately has three segments.
    written: normalizeKeys(
      stringRecord(parsed.written, (v) => (typeof v === "string" ? v : undefined)),
    ),
  };
}

/**
 * A persisted job row outlives the deploy that wrote it — that is the whole
 * point of persisting it — so its draft paths can be spelled the way TWO
 * earlier schemes spelled them, and neither is a legal target any more:
 *
 *   * the file extension is gone from every ADDRESS, and a `.md`
 *     path is rejected outright by the NPC apply pattern (400 on
 *     „Übernehmen") or would insert a scene row whose id nothing can address.
 *   * a scene draft's path is `<chapter>/<id>`: the group
 *     segment IS the `location`, and the SERVER derives it on the way in.
 *     A three-segment scene path is now a client naming a group of its own,
 *     which `applySceneTarget` answers with a 400 — for a `done` job stored
 *     before this deploy, forever. The drafts are still perfectly good, so
 *     the group segment is dropped instead of the run.
 *
 * So a persisted job is normalized ONCE, on the way out of the row: both
 * rewrites are applied to every draft path and to every KEY that is one of
 * those paths (`draftEdits`, `review.written`, `review.dropped`). The review
 * patch and apply then both see the current scheme, and a fresh row — where
 * nothing ends in `.md` and no scene path has three segments — passes
 * through untouched.
 */
function draftAddress(path: string): string {
  const stripped = path.endsWith(".md") ? path.slice(0, -3) : path;
  const segments = stripped.split("/");
  // Only a SCENE path collapses: `npcs/<id>`/`locations/<id>` have two
  // segments anyway, and a chapter is not a draft path.
  if (segments.length !== 3) return stripped;
  if (RESERVED_SEGMENTS.has(segments[0]!)) return stripped;
  return `${segments[0]!}/${segments[2]!}`;
}

/** The same rewrite over the KEYS of a persisted path-keyed record. */
function normalizeKeys<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) out[draftAddress(key)] = value;
  return out;
}

/** Rewrite the draft paths of a persisted payload in place (see draftAddress). */
function normalizeDraftPaths(result?: GenerateResult, npcResult?: GenerateNpcResult): void {
  const scenes = result?.scenes;
  if (Array.isArray(scenes)) {
    for (const scene of scenes) {
      if (typeof scene?.path === "string") scene.path = draftAddress(scene.path);
    }
  }
  const npc = npcResult?.npc;
  if (npc !== undefined && npc !== null && typeof npc.path === "string") {
    npc.path = draftAddress(npc.path);
  }
}

/**
 * What the DM reads when a finished job's payload column is unreadable (a
 * truncated write, a hand-edited database). The wording is the one the
 * failure block already renders, and it names the only way forward.
 */
export const UNREADABLE_PAYLOAD_MESSAGE =
  "Das Ergebnis dieses Durchlaufs ist nicht mehr lesbar. Verwirf den Job und starte ihn neu.";

function toJob(row: JobRow): Job {
  let status: Job["status"] =
    row.status === "done" || row.status === "failed" ? row.status : "running";
  const result = unpackPayload<GenerateResult>(row.result);
  const npcResult = unpackPayload<GenerateNpcResult>(row.npcResult);
  const augmentResult = unpackPayload<AugmentResult>(row.augmentResult);
  let error = unpackPayload<GenerateJobError>(row.error);
  normalizeDraftPaths(result, npcResult);
  const pipeline = unpackPipeline(row.pipeline);

  // A finished job with nothing readable to show is degraded to `failed` with
  // an error body: `done` without a result would render review blocks that
  // are gated on it — no drafts, no "Verwerfen", nothing the DM can do — and
  // `failed` without a body would render an empty failure. As a failed job
  // with a message the existing block appears, and discarding works.
  const nothingToShow =
    result === undefined && npcResult === undefined && augmentResult === undefined;
  if ((status === "done" && nothingToShow) || (status === "failed" && error === undefined)) {
    status = "failed";
    error = { status: 500, body: { error: UNREADABLE_PAYLOAD_MESSAGE } };
  }

  return {
    id: row.id,
    campaign: row.campaignId,
    kind: row.kind === "npc" || row.kind === "augment" ? row.kind : "scene",
    ...(row.chapter === null ? {} : { chapter: row.chapter }),
    ...(row.targetPath === null ? {} : { target: row.targetPath }),
    status,
    startedAt: row.startedAt,
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
    ...(result === undefined ? {} : { result }),
    ...(npcResult === undefined ? {} : { npcResult }),
    ...(augmentResult === undefined ? {} : { augmentResult }),
    ...(error === undefined ? {} : { error }),
    draftEdits: unpackEdits(row.draftEdits),
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
  return {
    ...(parsed.outline === undefined ? {} : { outline: parsed.outline as RunOutline }),
    parts,
    totals: {
      inputTokens: num(totals.inputTokens),
      outputTokens: num(totals.outputTokens),
      calls: num(totals.calls),
    },
  };
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
  // An augment run targets an entry that EXISTS. At least one of
  // sourceText/instruction is there — the route enforces that before a job
  // is created, and runAugment asserts it again.
  | { kind: "augment"; target: string; sourceText: string; instruction: string }
);

/**
 * Start a run in the background. One job per campaign: while one is RUNNING
 * a second start is a 409 carrying the running job's id (the app adopts it
 * instead of erroring). A finished job — done or failed — is simply replaced;
 * the DM asked for a new run.
 *
 * The gate and the row swap happen in ONE transaction, so two starts that
 * arrive together cannot both win: the second finds the first row and gets
 * its 409, and the table holds at most one row per campaign at all times.
 *
 * The provider is passed in because POST /generate resolves it up front, so
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
    ...(input.kind === "augment" ? { target: input.target } : {}),
    status: "running",
    startedAt: timestamp(),
    draftEdits: new Map(),
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
      throw new ApiError(409, "a generate job is already running for this campaign", {
        jobId: running.id,
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
        targetPath: job.target ?? null,
        status: "running",
        startedAt: job.startedAt,
        draftEdits: "{}",
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
      if (input.kind === "augment") {
        const augmentResult = await runAugment(
          input.campaign,
          input.target,
          { sourceText: input.sourceText, instruction: input.instruction },
          () => input.provider,
        );
        await finish(job, { status: "done", augmentResult: JSON.stringify(augmentResult) });
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
      // one call per scene and per suggested entry, three at a time. The sink
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
        console.error("could not record the failed generate job", finishErr);
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
//     acceptable while its siblings are still going (AK2),
//   * a restart keeps the done parts and fails only what was in flight
//     (AK3, db/job-boot.ts).
//
// `cancelled()` asks the DATABASE, not a flag: the row is the only thing that
// knows whether this run is still the campaign's run. „Verwerfen" deletes the
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
  const stubs = [...result.stubs];
  if (outcome.scene !== undefined) {
    const at = scenes.findIndex((s) => s.path === outcome.scene?.path);
    if (at === -1) scenes.push(outcome.scene);
    else scenes[at] = outcome.scene;
  }
  if (outcome.stub !== undefined) {
    const stub = outcome.stub;
    const at = stubs.findIndex((s) => s.kind === stub.kind && s.id === stub.id);
    // Deduped by id (Zuschnitt 3): a retried part replaces its own entry
    // rather than proposing the same npc twice.
    if (at === -1) stubs.push(stub);
    else stubs[at] = stub;
  }
  const warnings = [...result.warnings];
  for (const warning of outcome.warnings) if (!warnings.includes(warning)) warnings.push(warning);
  const namingHints = [...(result.namingHints ?? []), ...outcome.namingHints];
  return {
    scenes,
    stubs,
    warnings,
    ...(namingHints.length === 0 ? {} : { namingHints }),
  };
}

/**
 * Order the result the way the OUTLINE ordered the parts: the review shows
 * the parts in outline order (Zuschnitt 2), and parts finish out of order
 * because three of them run at once.
 */
function inPartOrder(result: GenerateResult, parts: readonly StoredPart[]): GenerateResult {
  const sceneRank = new Map(parts.filter((p) => p.kind === "scene").map((p, i) => [p.id, i]));
  const entryRank = new Map(
    parts.filter((p) => p.kind !== "scene").map((p, i) => [`${p.kind}:${p.id}`, i]),
  );
  const rank = (map: Map<string, number>, key: string): number => map.get(key) ?? Number.MAX_SAFE_INTEGER;
  return {
    ...result,
    scenes: [...result.scenes].sort(
      (a, b) =>
        rank(sceneRank, a.path.slice(a.path.lastIndexOf("/") + 1)) -
        rank(sceneRank, b.path.slice(b.path.lastIndexOf("/") + 1)),
    ),
    stubs: [...result.stubs].sort(
      (a, b) => rank(entryRank, `${a.kind}:${a.id}`) - rank(entryRank, `${b.kind}:${b.id}`),
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
function allPartsFailed(pipeline: PipelineRecord): GenerateJobError {
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
    const base: GenerateResult = stored ?? { scenes: [], stubs: [], warnings: [] };
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
        // that read the whole source text, so „der Quelltext nennt keine
        // Statblocks" can only come from here.
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
          // being written again has none, and leaving the old one there put
          // „was kam zurück" under a running part (and into the next
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

// --- „Erneut versuchen" per part ---------------------------------------------

/**
 * Restart ONE part of a run. Only that part: the outline stays, the finished
 * parts stay reviewable, and the retried part goes back through exactly the
 * call it failed on (`runPart`) — same prompt, same excerpt, same validation.
 *
 * 404 when the campaign has no job, when `jobId` names a different one or
 * when the run has no such part; 409 when the part is already running, still
 * PENDING (the pool owns it — it has not had its turn yet) or already done (a
 * double click is not a reason to spend tokens twice).
 *
 * The revive is ONE TRANSACTION over a re-read row, and that is not a detail:
 * `replanStoredRun` awaits the campaign context, and while it does a sibling
 * part of the very same run can report `partDone`. Writing back the pipeline
 * this function read BEFORE that await used to clobber the sibling's status
 * (it flipped from `done` to `running`) and with it the run's ability to ever
 * settle. So the transaction re-reads the row, mutates ONLY the addressed
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
    throw new ApiError(404, "no generate job for this campaign");
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
      throw new ApiError(404, "no generate job for this campaign");
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
  // A PENDING part still belongs to the run's own pool: it has not had its
  // turn yet, and reviving it here would run it twice — once from the pool,
  // once from this call, both writing the same part.
  if (part.status === "pending") throw new ApiError(409, "this part has not run yet");
  if (job.chapter === undefined) throw new ApiError(409, "this job has no target chapter");
  return part;
}

// --- discard -----------------------------------------------------------------

/** Discard the campaign's job (any status). False when there was none. */
export async function deleteJob(campaign: string): Promise<boolean> {
  const db = await getDb();
  if (jobRow(db, campaign) === undefined) return false;
  db.delete(generateJobs).where(eq(generateJobs.campaignId, campaign)).run();
  return true;
}

// Discarding the job an apply came from is NOT here: it belongs to the same
// transaction as the writes, so it lives in store/write.ts `applyDrafts`.
// A separate "delete if current" call after the write left a
// window in which a crash kept a done job whose drafts were already stored.

// --- review edits ------------------------------------------------------------


// --- review state ------------------------------------------------------------

/**
 * What one `PATCH …/review` may change. Every field is OPTIONAL and MERGES:
 * the app sends the one decision the DM just made (or the text of the one
 * draft they are typing in), never the whole state — so two half-finished
 * reviews of different parts cannot overwrite each other inside one rev.
 *
 * `dropped` is the one exception: a set, sent whole, because "no longer
 * dropped" has to be expressible too. In `entries`, `fields` and `blocks` a
 * `null` value DELETES the key — „wieder offen", and the only way to clear
 * decisions whose keys no longer exist (an augment re-alignment cuts new
 * block ids).
 */
export interface ReviewPatch {
  edits?: Record<string, string>;
  entries?: Record<string, GenerateReviewDecision | null>;
  dropped?: string[];
  fields?: Record<string, boolean | null>;
  blocks?: Record<string, boolean | null>;
}

/**
 * Store a review patch on the job. The `rev` the client read
 * must still be the row's — a second tab that decided something first makes
 * this a 409 `rev_conflict` carrying the CURRENT rev, and the app reloads
 * the state instead of silently winning.
 *
 * 404 when the campaign has no job or when `jobId` names a different one: a
 * patch for a run that was replaced must not land on its successor.
 */
export async function patchJobReview(
  campaign: string,
  jobId: string,
  rev: number,
  patch: ReviewPatch,
): Promise<Job> {
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const row = jobRow(tx, campaign);
    if (row === undefined || row.id !== jobId) {
      throw new ApiError(404, "no generate job for this campaign");
    }
    if (row.rev !== rev) {
      throw new ApiError(409, "the review state changed — reload before saving", {
        code: "rev_conflict",
        rev: row.rev,
      });
    }
    const job = toJob(row);
    assertKnownDraftPaths(job, patch);
    applyReviewPatch(job, patch);
    tx.update(generateJobs)
      .set({
        draftEdits: JSON.stringify(Object.fromEntries(job.draftEdits)),
        review: JSON.stringify(job.review),
        rev: row.rev + 1,
      })
      .where(eq(generateJobs.id, row.id))
      .run();
    return { ...job, rev: row.rev + 1 };
  }) as Job;
}

/**
 * A draft path the run never produced is a client bug, not state to store.
 * `PUT …/job/drafts` always checked this;
 * the review patch that replaced it did not, so a typo grew a `draftEdits`
 * key nothing would ever read again.
 */
function assertKnownDraftPaths(job: Job, patch: ReviewPatch): void {
  for (const path of Object.keys(patch.edits ?? {})) {
    const rel = draftAddress(path);
    const known =
      job.result?.scenes.some((scene) => scene.path === rel) === true ||
      job.npcResult?.npc.path === rel;
    if (!known) throw new ApiError(400, `unknown draft path: ${path}`);
  }
}

/** Merge a patch into a job in memory (the transaction writes the result). */
function applyReviewPatch(job: Job, patch: ReviewPatch): void {
  for (const [path, markdown] of Object.entries(patch.edits ?? {})) {
    job.draftEdits.set(draftAddress(path), markdown);
  }
  for (const [key, decision] of Object.entries(patch.entries ?? {})) {
    // `null` is „wieder offen" — the review's third state, which is why an
    // undo has to be expressible and is not just a missing key.
    if (decision === null) delete job.review.entries[key];
    else job.review.entries[key] = decision;
  }
  if (patch.dropped !== undefined) job.review.dropped = [...new Set(patch.dropped)];
  assignFlags(job.review.fields, patch.fields);
  assignFlags(job.review.blocks, patch.blocks);
}

/** Merge boolean decisions; `null` deletes the key (see ReviewPatch). */
function assignFlags(into: Record<string, boolean>, patch?: Record<string, boolean | null>): void {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete into[key];
    else into[key] = value;
  }
}

/**
 * Record a partial accept on the job — called INSIDE the write transaction
 * (store/write.ts `applyDrafts`), so the job and the entries it produced can
 * never disagree after a crash: either both landed or neither did (the same
 * rule the whole-run apply follows).
 *
 * Returns true when the job row was deleted because nothing is left open.
 *
 * `rev` is the review rev the client read.
 * The row is re-read HERE, inside the transaction. A job that MOVED (rev) or
 * VANISHED in the meantime throws, which rolls the whole write back — the
 * pre-read the accept planned with is then stale. Reporting a lost job as a
 * quiet `false` used to commit the drafts while silently dropping the
 * bookkeeping that says they were written, so the next „Alle übernehmen"
 * would have written them a second time.
 */
export function markWrittenInTx(
  tx: GrimoireDb,
  campaign: string,
  jobId: string,
  rev: number,
  written: Record<string, string>,
): boolean {
  const row = jobRow(tx, campaign);
  if (row === undefined || row.id !== jobId) {
    throw new ApiError(404, "no generate job for this campaign");
  }
  if (row.rev !== rev) {
    throw new ApiError(409, "the review state changed — reload before accepting", {
      code: "rev_conflict",
      rev: row.rev,
    });
  }
  const job = toJob(row);
  // Openness is recomputed from the row THIS transaction sees, never from
  // the caller's pre-read: a part that was dropped or rejected in between
  // must not be assigned `written`.
  const open = openPartPaths(job);
  for (const rel of Object.keys(written)) {
    if (open.has(rel)) continue;
    throw new ApiError(409, "the review state changed — reload before accepting", {
      code: "rev_conflict",
      rev: row.rev,
    });
  }
  Object.assign(job.review.written, written);
  if (jobIsSettled(job)) {
    tx.delete(generateJobs).where(eq(generateJobs.id, row.id)).run();
    return true;
  }
  tx.update(generateJobs)
    .set({ review: JSON.stringify(job.review), rev: row.rev + 1 })
    .where(eq(generateJobs.id, row.id))
    .run();
  return false;
}

/**
 * Which parts of a finished run are still OPEN, addressed the way the review
 * addresses them. The one place that question is answered — the accept reads
 * it INSIDE its transaction so a decision made between the pre-read and the
 * commit cannot be written over.
 */
export function openPartPaths(job: Job): Set<string> {
  const written = job.review.written;
  const dropped = new Set(job.review.dropped);
  const open = new Set<string>();
  for (const scene of job.result?.scenes ?? []) {
    if (written[scene.path] === undefined && !dropped.has(scene.path)) open.add(scene.path);
  }
  for (const stub of job.result?.stubs ?? []) {
    const path = `${stub.kind}s/${stub.id}`;
    if (
      written[path] === undefined &&
      !dropped.has(path) &&
      job.review.entries[path] !== "rejected"
    ) {
      open.add(path);
    }
  }
  const npc = job.npcResult?.npc.path;
  if (npc !== undefined && written[npc] === undefined) open.add(npc);
  return open;
}

/**
 * Is there anything left to decide? Every scene is written or dropped, every
 * suggested entry is written or rejected, and an NPC run's one draft is
 * written. That question is what makes the job DISAPPEAR on its own
 * instead of leaving an empty review behind.
 */
export function jobIsSettled(job: Job): boolean {
  // A pipelined run with parts still pending, running or failed is NOT
  // settled, however much of it the DM has accepted: deleting
  // the row would throw away the outline every open part still needs.
  if (job.pipeline !== undefined && job.pipeline.parts.length > 0) {
    if (job.pipeline.parts.some((p) => p.status !== "done")) return false;
  }
  const written = job.review.written;
  const dropped = new Set(job.review.dropped);
  const scenes = job.result?.scenes ?? [];
  for (const scene of scenes) {
    if (written[scene.path] === undefined && !dropped.has(scene.path)) return false;
  }
  for (const stub of job.result?.stubs ?? []) {
    const path = `${stub.kind}s/${stub.id}`;
    if (written[path] === undefined && job.review.entries[path] !== "rejected") return false;
  }
  const npc = job.npcResult?.npc.path;
  if (npc !== undefined && written[npc] === undefined) return false;
  return true;
}

/** Test-only: drop every job row. */
export async function clearJobsForTests(): Promise<void> {
  const db = await getDb();
  db.delete(generateJobs).run();
}
