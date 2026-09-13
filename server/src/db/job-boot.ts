// What a generator job that was RUNNING when the process died becomes at the
// next boot (issue #23).
//
// Its own module, small on purpose: the job store (../generate-jobs.ts) needs
// the database handle (../store/handle.ts), and the handle needs this function
// — putting it next to the job store would close that import cycle. Everything
// here depends on the schema and the clock only.

import { eq } from "drizzle-orm";
import type { GenerateJobError } from "@grimoire/shared";
import { now } from "../clock";
import type { GrimoireDb } from "./client";
import { generateJobs } from "./schema";

/**
 * What an interrupted run answers. ENGLISH since issue #69: the sentence the
 * DM reads comes from the app's catalog via `code: "job_restarted"`, and this
 * text is the technical fallback next to it. 503 because that is what the
 * synchronous endpoint would have answered for "this server could not carry
 * the run out" — and the app shows a 503's message instead of a validation
 * block.
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
    .select({ id: generateJobs.id })
    .from(generateJobs)
    .where(eq(generateJobs.status, "running"))
    .all();
  if (stale.length === 0) return 0;
  db.update(generateJobs)
    .set({
      status: "failed",
      error: JSON.stringify(RESTART_FAILURE),
      finishedAt: now().toISOString(),
    })
    .where(eq(generateJobs.status, "running"))
    .run();
  return stale.length;
}
