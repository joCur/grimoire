// Background generate jobs (issue #19) — born from a production loss: a
// finished, good generation died with a browser-back gesture because the
// run was one synchronous request and the result lived only in client state.
//
// The fix is deliberately small:
//
//   - ONE job per campaign, held in memory (Map keyed by campaign id) —
//     since issue #21 regardless of its KIND: a scene run and an NPC run
//     share the store and the 409 gate, `kind` only says which result field
//     is filled (and which UI mode to restore).
//   - POST /generate validates as before, then starts a job and answers 202;
//     the pipeline (./generator runGenerate) is untouched — same prompt, same
//     validation, same correction turns, same 422 shaping.
//   - a finished job KEEPS its result until it is applied, discarded or
//     replaced by the next run, so navigation/reload/restart of the tab
//     costs nothing.
//   - review edits live in the job too (draftEdits), so an edited draft
//     survives the same way.
//
// Explicitly NOT persisted to disk (issue #19 non-goal): the campaign files
// stay the only truth on the platter. A server restart therefore loses jobs
// — the app notices the 404 and says so instead of spinning forever.
//
// A failed run is stored as the ANSWER the synchronous endpoint would have
// given (status + JSON body), so nothing about the 422 semantics of issues
// #18/#20 (rawReply, usage, validationErrors) changes for the client.

import { randomUUID } from "node:crypto";
import type {
  GenerateJob,
  GenerateJobError,
  GenerateJobKind,
  GenerateNpcResult,
  GenerateResult,
} from "@grimoire/shared";
import { ApiError } from "./campaign-fs";
import { now } from "./clock";
import { runGenerate, runGenerateNpc } from "./generator";
import type { LLMProvider } from "./llm-provider";

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

/** campaign id -> its one job. */
const jobs = new Map<string, Job>();

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

/** The campaign's job, or undefined when there is none. */
export function getJob(campaign: string): Job | undefined {
  return jobs.get(campaign);
}

/**
 * Start a run in the background. One job per campaign: while one is RUNNING
 * a second start is a 409 carrying the running job's id (the app adopts it
 * instead of erroring). A finished job — done or failed — is simply replaced;
 * the DM asked for a new run.
 *
 * The provider is passed in because POST /generate resolves it up front, so
 * "no provider configured" stays a synchronous 503 instead of becoming a
 * failed job.
 */
export function startJob(input: JobInput): Job {
  const running = jobs.get(input.campaign);
  if (running !== undefined && running.status === "running") {
    throw new ApiError(409, "a generate job is already running for this campaign", {
      jobId: running.id,
    });
  }

  const job: Job = {
    id: randomUUID(),
    campaign: input.campaign,
    kind: input.kind,
    ...(input.kind === "scene" ? { chapter: input.chapter } : {}),
    status: "running",
    startedAt: timestamp(),
    draftEdits: new Map(),
  };
  jobs.set(input.campaign, job);

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
        finish(job, (j) => {
          j.status = "done";
          j.npcResult = npcResult;
        });
        return;
      }
      const result = await runGenerate(
        input.campaign,
        input.chapter,
        input.sourceText,
        input.newChapter,
        () => input.provider,
      );
      finish(job, (j) => {
        j.status = "done";
        j.result = result;
      });
    } catch (err) {
      const error = shapeError(err);
      finish(job, (j) => {
        j.status = "failed";
        j.error = error;
      });
    }
  })();

  return job;
}

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
 * Write the outcome — but only while the job is still the campaign's current
 * one. A run the DM discarded (or replaced by a new start) must not come
 * back to life when its provider call finally returns.
 */
function finish(job: Job, apply: (job: Job) => void): void {
  if (jobs.get(job.campaign) !== job) return;
  apply(job);
  job.finishedAt = timestamp();
}

/** Discard the campaign's job (any status). False when there was none. */
export function deleteJob(campaign: string): boolean {
  return jobs.delete(campaign);
}

/**
 * Discard the job iff it is the one the client means. Used by apply: the
 * drafts are on disk, so the job has done its work — but only that job,
 * never a newer run that started meanwhile.
 */
export function deleteJobIfCurrent(campaign: string, jobId: string): boolean {
  const job = jobs.get(campaign);
  if (job === undefined || job.id !== jobId) return false;
  jobs.delete(campaign);
  return true;
}

/**
 * Store one review edit in the job (PUT …/generate/job/drafts). 404 without
 * a job, 400 for a path that is not one of the result's draft paths — the
 * store is not a free-form key/value bag, and an unknown path is a client
 * bug worth seeing. Editable are the scene drafts of a scene run and the one
 * npc draft of an NPC run (issue #21); stub markdown is not editable in the
 * review, so stubs are not accepted.
 */
export function setDraftEdit(campaign: string, rel: string, markdown: string): void {
  const job = jobs.get(campaign);
  if (job === undefined) throw new ApiError(404, "no generate job for this campaign");
  const known =
    job.result?.scenes.some((scene) => scene.path === rel) === true ||
    job.npcResult?.npc.path === rel;
  if (!known) throw new ApiError(400, `unknown draft path: ${rel}`);
  job.draftEdits.set(rel, markdown);
}

/**
 * Test-only: drop every job — also the simulation of a server restart (the
 * store is the only place jobs live).
 */
export function clearJobsForTests(): void {
  jobs.clear();
}
