// What the boot does to scene chat replies this server cannot write any more:
// a reply that was RUNNING when the process died.
//
// Its own module beside ./job-boot.ts, for the same reason: the store needs
// the database handle (../store/handle.ts), and the handle needs this
// function. Everything here depends on the schema only.

import { eq, sql } from "drizzle-orm";
import type { GrimoireDb } from "./client";
import { packJson, sceneChatMessages } from "./schema";

/**
 * The error body of a reply the restart took down. ENGLISH: the sentence the
 * DM reads comes from the app's catalog via its code.
 */
export const REPLY_RESTART_FAILURE = {
  code: "scene_chat_reply_restarted",
  error: "the server was restarted while the reply was being written — try again",
} as const;

/**
 * Turn every leftover `running` reply into a `failed` one with the restart
 * as its reason. Called ONCE per boot, right after the schema migrations
 * (store/handle.ts): the process that waited for those replies is gone, and
 * the app would otherwise poll them forever. The DM retries a failed reply
 * on its own. Returns how many replies were failed.
 */
export function failInterruptedReplies(db: GrimoireDb): number {
  const stale = db
    .select({ rev: sceneChatMessages.rev })
    .from(sceneChatMessages)
    .where(eq(sceneChatMessages.status, "running"))
    .all();
  if (stale.length === 0) return 0;
  db.update(sceneChatMessages)
    .set({
      status: "failed",
      error: packJson(REPLY_RESTART_FAILURE),
      rev: sql`${sceneChatMessages.rev} + 1`,
    })
    .where(eq(sceneChatMessages.status, "running"))
    .run();
  return stale.length;
}
