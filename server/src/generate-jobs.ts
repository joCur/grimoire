// Background generate jobs (issue #19) — born from a production loss: a
// finished, good generation died with a browser-back gesture because the
// run was one synchronous request and the result lived only in client state.
//
// The model is deliberately small:
//
//   - ONE job per campaign — since issue #21 regardless of its KIND: a scene
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
// SINCE ISSUE #23 THE JOB IS A DATABASE ROW (`generate_jobs`), not a Map.
// Issue #19 parked persistence as a non-goal because the campaign files were
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
// given (status + JSON body), so nothing about the 422 semantics of issues
// #18/#20 (rawReply, usage, validationErrors) changes for the client.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  AugmentResult,
  GenerateJob,
  GenerateJobReview,
  GenerateReviewDecision,
  GenerateJobError,
  GenerateJobKind,
  GenerateNpcResult,
  GenerateResult,
} from "@grimoire/shared";
import { ApiError } from "./campaign-fs";
import { now } from "./clock";
import type { GrimoireDb } from "./db/client";
import { generateJobs } from "./db/schema";
import { runAugment } from "./generator-augment";
import { runGenerate, runGenerateNpc } from "./generator";
import type { LLMProvider } from "./llm-provider";
import { getDb } from "./store/handle";
import { RESERVED_SEGMENTS } from "./store/paths";

/** Server-side job record; `draftEdits` is a Map here, an object on the wire. */
interface Job {
  id: string;
  campaign: string;
  /** Scene run or NPC run (issue #21) — still one job per campaign. */
  kind: GenerateJobKind;
  /** Target chapter; only a scene run has one. */
  chapter?: string;
  /** Address of the entry an AUGMENT run works on (issue #36). */
  target?: string;
  status: "running" | "done" | "failed";
  result?: GenerateResult;
  npcResult?: GenerateNpcResult;
  augmentResult?: AugmentResult;
  error?: GenerateJobError;
  startedAt: string;
  finishedAt?: string;
  draftEdits: Map<string, string>;
  /** The DM's review state (issue #97) — decisions, drops, written parts. */
  review: GenerateJobReview;
  /** Optimistic-concurrency token of that review state. */
  rev: number;
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

/** The review state of a job that has not been touched yet (issue #97). */
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
 *   * issue #79 dropped the file extension from every ADDRESS, and a `.md`
 *     path is rejected outright by the NPC apply pattern (400 on
 *     „Übernehmen") or would insert a scene row whose id nothing can address.
 *   * issue #100 made a scene draft's path `<chapter>/<id>`: the group
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
  // segments anyway, and a chapter document is not a draft path.
  if (segments.length !== 3) return stripped;
  if (RESERVED_SEGMENTS.has(segments[0]!) || segments[2] === "_chapter") return stripped;
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
 * What a run needs, per kind (issue #21). One union instead of two start
 * functions: the 409 gate ("one generator job per campaign, whatever its
 * kind") must exist exactly once.
 */
export type JobInput = { campaign: string; provider: LLMProvider } & (
  | { kind: "scene"; chapter: string; sourceText: string; newChapter: boolean }
  | { kind: "npc"; sourceText: string; npcId?: string }
  // Issue #36: an augment run targets an entry that EXISTS. At least one of
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
      const result = await runGenerate(
        input.campaign,
        input.chapter,
        input.sourceText,
        input.newChapter,
        () => input.provider,
      );
      await finish(job, { status: "done", result: JSON.stringify(result) });
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

// --- discard -----------------------------------------------------------------

/** Discard the campaign's job (any status). False when there was none. */
export async function deleteJob(campaign: string): Promise<boolean> {
  const db = await getDb();
  if (jobRow(db, campaign) === undefined) return false;
  db.delete(generateJobs).where(eq(generateJobs.campaignId, campaign)).run();
  return true;
}

// Discarding the job an apply came from is NOT here: it belongs to the same
// transaction as the writes, so it lives in store/write.ts `applyDrafts`
// (issue #62). A separate "delete if current" call after the write left a
// window in which a crash kept a done job whose drafts were already stored.

// --- review edits ------------------------------------------------------------


// --- review state (issue #97) -----------------------------------------------

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
 * block ids; issue #97 review, finding 5).
 */
export interface ReviewPatch {
  edits?: Record<string, string>;
  entries?: Record<string, GenerateReviewDecision | null>;
  dropped?: string[];
  fields?: Record<string, boolean | null>;
  blocks?: Record<string, boolean | null>;
}

/**
 * Store a review patch on the job (issue #97). The `rev` the client read
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
 * A draft path the run never produced is a client bug, not state to store
 * (issue #97 review, finding 8). `PUT …/job/drafts` always checked this;
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
 * never disagree after a crash: either both landed or neither did (the rule
 * issue #62 established for the whole-run apply).
 *
 * Returns true when the job row was deleted because nothing is left open.
 *
 * `rev` is the review rev the client read (issue #97 review, findings 3+4).
 * The row is re-read HERE, inside the transaction. A job that MOVED (rev) or
 * VANISHED in the meantime throws, which rolls the whole write back — the
 * pre-read the accept planned with is then stale. Reporting a lost job as a
 * quiet `false` used to commit the drafts while silently dropping the
 * bookkeeping that says they were written, so the next „Alle übernehmen"
 * would have written them a second time (issue #97 review, finding 4).
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
  // must not be assigned `written` (issue #97 review, finding 3).
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
 * commit cannot be written over (issue #97 review, finding 3).
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
 * written. That question is what makes the job DISAPPEAR on its own (issue
 * #97 Zuschnitt 3) instead of leaving an empty review behind.
 */
export function jobIsSettled(job: Job): boolean {
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
