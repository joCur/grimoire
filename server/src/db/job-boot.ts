// What the boot does to generator jobs this server cannot honour any more:
// a job that was RUNNING when the process died, and a job whose stored
// drafts are in the pre-ADR-#24 shape.
//
// Its own module, small on purpose: the job store (../generate-jobs.ts) needs
// the database handle (../store/handle.ts), and the handle needs these
// functions — putting them next to the job store would close that import
// cycle. Everything here depends on the schema only.

import { eq } from "drizzle-orm";
import type { GenerateJobError } from "@grimoire/shared";
import type { GrimoireDb } from "./client";
import { generateJobs } from "./schema";

/**
 * What an interrupted run answers. ENGLISH: the sentence the DM reads comes
 * from the app's catalog via `code: "job_restarted"`, and this text is the
 * technical fallback next to it. 503 because that is what the synchronous
 * endpoint would have answered for "this server could not carry the run
 * out" — and the app shows a 503's message instead of a validation block.
 */
export const RESTART_FAILURE_MESSAGE =
  "the server was restarted while the job was running — start the job again";

export const RESTART_FAILURE: GenerateJobError = {
  status: 503,
  body: { code: "job_restarted", error: RESTART_FAILURE_MESSAGE },
};

/**
 * What a job whose drafts predate the current draft format answers. Same
 * shape and same reason as the restart failure: a `code` the app has a
 * sentence for, plus the English fallback.
 */
export const DRAFT_FORMAT_FAILURE_MESSAGE =
  "this job predates the current draft format — its drafts cannot be " +
  "reviewed or accepted any more; start the run again";

export const DRAFT_FORMAT_FAILURE: GenerateJobError = {
  status: 409,
  body: { code: "job_draft_format", error: DRAFT_FORMAT_FAILURE_MESSAGE },
};

/**
 * Turn every leftover `running` row into a `failed` one. Called ONCE per boot,
 * right after the schema migrations (store/handle.ts): the process that owned
 * those provider calls is gone, so a `running` row is a promise nobody can
 * keep and the app would poll it forever. `done` and `failed` rows are left
 * exactly as they are — surviving them whole is the point of persisting jobs.
 *
 * Returns how many rows were rewritten, which the boot log reports.
 */
export function failInterruptedJobs(db: GrimoireDb): number {
  const stale = db
    .select({ id: generateJobs.id, pipeline: generateJobs.pipeline })
    .from(generateJobs)
    .where(eq(generateJobs.status, "running"))
    .all();
  if (stale.length === 0) return 0;
  const at = new Date().toISOString();
  for (const row of stale) {
    const parts = recoverParts(row.pipeline);
    if (parts === null) {
      // A single-call run (npc, augment) or a row without a pipeline: there
      // is nothing to keep, so the whole job becomes the failed one the app
      // already renders.
      db.update(generateJobs)
        .set({ status: "failed", error: JSON.stringify(RESTART_FAILURE), finishedAt: at })
        .where(eq(generateJobs.id, row.id))
        .run();
      continue;
    }
    // A PIPELINED run: the parts that were in flight — and the ones that were
    // still waiting for a worker — died with the process, so they become
    // `failed` and carry the retry action. Parts that were already `done` are
    // kept: their drafts are on the row and the DM can review and accept
    // them. The job is `done` as soon as one part survived, and `failed` with
    // the restart message when none did.
    const anyDone = parts.parts.some((p) => p.status === "done");
    db.update(generateJobs)
      .set({
        status: anyDone ? "done" : "failed",
        pipeline: JSON.stringify(parts.pipeline),
        finishedAt: at,
        ...(anyDone ? {} : { error: JSON.stringify(RESTART_FAILURE) }),
      })
      .where(eq(generateJobs.id, row.id))
      .run();
  }
  return stale.length;
}

/**
 * Fail every job whose stored drafts are in the OLD shape — one markdown text
 * per draft, properties block included — instead of the `{ properties, body }`
 * pair a draft is now (ADR #24). Called once per boot, next to the
 * interrupted-job pass.
 *
 * Nothing is converted. Parsing that text back is exactly the round trip the
 * format change removed, and a run costs a handful of tokens to repeat —
 * whereas a half-converted draft would be written into the campaign. So such
 * a row becomes a `failed` job whose error body says so, which is the one
 * state the app already renders with a way out („Verwerfen" and a new run).
 *
 * Returns how many rows were rewritten, which the boot log reports.
 */
export function failLegacyDraftJobs(db: GrimoireDb): number {
  const rows = db
    .select({
      id: generateJobs.id,
      result: generateJobs.result,
      npcResult: generateJobs.npcResult,
      draftEdits: generateJobs.draftEdits,
    })
    .from(generateJobs)
    .all();
  const at = new Date().toISOString();
  let failed = 0;
  for (const row of rows) {
    if (!isLegacyJob(row)) continue;
    failed += 1;
    db.update(generateJobs)
      .set({
        status: "failed",
        error: JSON.stringify(DRAFT_FORMAT_FAILURE),
        finishedAt: at,
      })
      .where(eq(generateJobs.id, row.id))
      .run();
  }
  return failed;
}

/** Does this row carry a draft or a draft edit in the old markdown shape? */
function isLegacyJob(row: {
  result: string | null;
  npcResult: string | null;
  draftEdits: string;
}): boolean {
  const result = readJson(row.result);
  if (result !== undefined) {
    for (const key of ["scenes", "stubs"]) {
      const items = result[key];
      if (Array.isArray(items) && items.some(isLegacyDraft)) return true;
    }
  }
  const npcResult = readJson(row.npcResult);
  if (npcResult !== undefined && isLegacyDraft(npcResult.npc)) return true;
  const edits = readJson(row.draftEdits);
  // An edit was a plain text; it is an object with the edited halves now.
  if (edits !== undefined && Object.values(edits).some((value) => typeof value === "string")) {
    return true;
  }
  return false;
}

/**
 * One draft of a stored payload, judged by its halves: a draft carries its
 * `body` as a string. A `markdown` text instead of it is the old shape, and
 * so is a draft that carries no body at all — a payload nothing can read as a
 * draft any more either way.
 */
function isLegacyDraft(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.markdown === "string" || typeof draft.body !== "string";
}

/** One JSON payload column as a record, or undefined when it is not one. */
function readJson(value: string | null): Record<string, unknown> | undefined {
  if (value === null || value === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * The pipeline of an interrupted row with every OPEN part failed, or null
 * when the row has no parts (a single-call run, or a row written before the
 * pipeline existed). Degrades like every other payload read: an unreadable
 * column is treated as "no parts", which lands the row on the whole-job
 * failure.
 */
function recoverParts(
  value: string,
): { pipeline: Record<string, unknown>; parts: Array<{ status: string }> } | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const raw = parsed.parts;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parts = raw.map((item) => {
    const part = { ...(item as Record<string, unknown>) };
    if (part.status === "running" || part.status === "pending") {
      part.status = "failed";
      part.error = RESTART_FAILURE_MESSAGE;
    }
    return part as { status: string };
  });
  return { pipeline: { ...parsed, parts }, parts };
}
