// What the boot does to generator jobs this server cannot honour any more:
// a job that was RUNNING when the process died.
//
// Its own module, small on purpose: the job store (../generate-jobs.ts) needs
// the database handle (../store/handle.ts), and the handle needs this
// function — putting it next to the job store would close that import
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
