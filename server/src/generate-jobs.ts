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
  GenerateJob,
  GenerateJobError,
  GenerateJobKind,
  GenerateNpcResult,
  GenerateResult,
} from "@grimoire/shared";
import { ApiError } from "./campaign-fs";
import { now } from "./clock";
import type { GrimoireDb } from "./db/client";
import { generateJobs } from "./db/schema";
import { runGenerate, runGenerateNpc } from "./generator";
import type { LLMProvider } from "./llm-provider";
import { getDb } from "./store/handle";

/** Server-side job record; `draftEdits` is a Map here, an object on the wire. */
interface Job {
  id: string;
  campaign: string;
  /** Scene run or NPC run (issue #21) — still one job per campaign. */
  kind: GenerateJobKind;
  /** Target chapter; only a scene run has one. */
  chapter?: string;
  status: "running" | "done" | "failed";
  result?: GenerateResult;
  npcResult?: GenerateNpcResult;
  error?: GenerateJobError;
  startedAt: string;
  finishedAt?: string;
  draftEdits: Map<string, string>;
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
    status: job.status,
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.result === undefined ? {} : { result: job.result }),
    ...(job.npcResult === undefined ? {} : { npcResult: job.npcResult }),
    ...(job.error === undefined ? {} : { error: job.error }),
    draftEdits: Object.fromEntries(job.draftEdits),
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

/**
 * Entity ADDRESSES carry no file extension since issue #79, but a job row
 * written before that upgrade stored the draft paths the model produced —
 * `npcs/x.md`, `01-salzhafen/hafen/y.md`. Those rows outlive the deploy (that
 * is the whole point of persisting them), and a `.md` path is no longer a
 * legal address: the NPC apply pattern rejects it outright (400 on
 * "Übernehmen"), and a scene path would insert a row whose id nothing can
 * address.
 *
 * So a persisted job is normalized ONCE, on the way out of the row: the
 * suffix is stripped from every draft path and from the `draftEdits` keys
 * (which are those same paths). Review, `PUT …/job/drafts` and apply then all
 * see the new scheme, and a fresh row — where nothing ends in `.md` — passes
 * through untouched.
 */
function draftAddress(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
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
  let error = unpackPayload<GenerateJobError>(row.error);
  normalizeDraftPaths(result, npcResult);

  // A finished job with nothing readable to show is degraded to `failed` with
  // an error body: `done` without a result would render review blocks that
  // are gated on it — no drafts, no "Verwerfen", nothing the DM can do — and
  // `failed` without a body would render an empty failure. As a failed job
  // with a message the existing block appears, and discarding works.
  const nothingToShow = result === undefined && npcResult === undefined;
  if ((status === "done" && nothingToShow) || (status === "failed" && error === undefined)) {
    status = "failed";
    error = { status: 500, body: { error: UNREADABLE_PAYLOAD_MESSAGE } };
  }

  return {
    id: row.id,
    campaign: row.campaignId,
    kind: row.kind === "npc" ? "npc" : "scene",
    ...(row.chapter === null ? {} : { chapter: row.chapter }),
    status,
    startedAt: row.startedAt,
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
    ...(result === undefined ? {} : { result }),
    ...(npcResult === undefined ? {} : { npcResult }),
    ...(error === undefined ? {} : { error }),
    draftEdits: unpackEdits(row.draftEdits),
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
    status: "running",
    startedAt: timestamp(),
    draftEdits: new Map(),
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
        status: "running",
        startedAt: job.startedAt,
        draftEdits: "{}",
      })
      .run();
  });

  // Fire and forget — but never unhandled: the runner catches EVERYTHING and
  // turns it into a failed job.
  void (async () => {
    try {
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
  outcome: { status: "done" | "failed"; result?: string; npcResult?: string; error?: string },
): Promise<void> {
  const db = await getDb();
  db.update(generateJobs)
    .set({
      status: outcome.status,
      finishedAt: timestamp(),
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      ...(outcome.npcResult === undefined ? {} : { npcResult: outcome.npcResult }),
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

/**
 * Store one review edit in the job (PUT …/generate/job/drafts). 404 without
 * a job, 400 for a path that is not one of the result's draft paths — the
 * store is not a free-form key/value bag, and an unknown path is a client
 * bug worth seeing. Editable are the scene drafts of a scene run and the one
 * npc draft of an NPC run (issue #21); stub markdown is not editable in the
 * review, so stubs are not accepted.
 */
export async function setDraftEdit(
  campaign: string,
  rel: string,
  markdown: string,
): Promise<void> {
  const db = await getDb();
  const row = jobRow(db, campaign);
  if (row === undefined) throw new ApiError(404, "no generate job for this campaign");
  const job = toJob(row);
  const known =
    job.result?.scenes.some((scene) => scene.path === rel) === true ||
    job.npcResult?.npc.path === rel;
  if (!known) throw new ApiError(400, `unknown draft path: ${rel}`);
  job.draftEdits.set(rel, markdown);
  db.update(generateJobs)
    .set({ draftEdits: JSON.stringify(Object.fromEntries(job.draftEdits)) })
    .where(eq(generateJobs.id, row.id))
    .run();
}

/** Test-only: drop every job row. */
export async function clearJobsForTests(): Promise<void> {
  const db = await getDb();
  db.delete(generateJobs).run();
}
