// Partial accept of a finished generator run (issue #97).
//
// Its own module and not part of generator.ts for one reason: it needs both
// the draft VALIDATION (generator.ts) and the JOB store (generate-jobs.ts),
// and generate-jobs.ts already imports generator.ts to run the pipeline. A
// third module keeps that import graph a tree — the same split db/job-boot.ts
// exists for.

import { parseMarkdown } from "@grimoire/shared";
import { ApiError } from "./campaign-fs";
import { getJob, markWrittenInTx, openPartPaths } from "./generate-jobs";
import {
  applyNpcTarget,
  applySceneTarget,
  applyStubTarget,
  assertDraftId,
  draftAddress,
  newChapterTarget,
  type ApplyTarget,
} from "./generator";
import { locationPath, npcPath } from "./store/paths";
import { requireCampaign } from "./store/read";
import { applyDrafts } from "./store/write";

/**
 * Accept PART of a finished run (issue #97) — „Diesen übernehmen" per scene
 * and per suggested entry, and „Alle übernehmen" for whatever is left.
 *
 * The whole-run apply (`applyGenerated`) stays exactly as it was; this is
 * the same write with a selection in front of it and different job
 * bookkeeping behind it:
 *
 *   selection   scene draft paths and suggested-entry addresses
 *               (`npcs/grella`). Absent is „Alle übernehmen": every scene
 *               that is neither written nor dropped, plus the suggested
 *               entries the DM ACCEPTED — an undecided entry is not written
 *               by a bulk action, exactly as before this ticket, and a
 *               rejected one never is. Naming a path explicitly is the one
 *               way an undecided entry gets written („Diesen übernehmen"
 *               on its row is the decision).
 *   transaction one, with the target rev guards of the ordinary draft write
 *               (`applyDrafts`: conflicts checked INSIDE it, FTS and
 *               `[[slug]]` reference rows follow because this is that path).
 *   job         the written parts are recorded ON the job in that same
 *               commit, and the row is deleted the moment nothing is left
 *               open. „Verwerfen" (DELETE …/job) therefore removes only the
 *               open rest — what was written is an entry now, not a job.
 */
export async function acceptJobParts(
  campaign: string,
  jobId: string,
  rev: number,
  body: { paths?: unknown; chapter?: unknown; chapterTitle?: unknown },
): Promise<{ written: Record<string, string>; jobDeleted: boolean }> {
  await requireCampaign(campaign);
  const job = await getJob(campaign);
  if (job === undefined || job.id !== jobId) {
    throw new ApiError(404, "no generate job for this campaign");
  }
  if (job.status !== "done") throw new ApiError(409, "this job has no result to accept");

  const review = job.review;
  const dropped = new Set(review.dropped);
  /** Every part of this run, by the path the review addresses it with. */
  const parts = new Map<string, { target: ApplyTarget; open: boolean; bulk: boolean }>();
  job.result?.scenes.forEach((scene, index) => {
    const markdown = job.draftEdits.get(scene.path) ?? scene.markdown;
    const open = review.written[scene.path] === undefined && !dropped.has(scene.path);
    parts.set(scene.path, {
      target: applySceneTarget({ path: scene.path, markdown }, index),
      open,
      bulk: open,
    });
  });
  job.result?.stubs.forEach((stub, index) => {
    const rel = stub.kind === "npc" ? npcPath(stub.id) : locationPath(stub.id);
    const decision = review.entries[rel];
    const open =
      review.written[rel] === undefined && decision !== "rejected" && !dropped.has(rel);
    parts.set(rel, {
      target: applyStubTarget(stub, index),
      open,
      bulk: open && decision === "accepted",
    });
  });
  const npcDraft = job.npcResult?.npc;
  if (npcDraft !== undefined) {
    const markdown = job.draftEdits.get(npcDraft.path) ?? npcDraft.markdown;
    const open = review.written[npcDraft.path] === undefined;
    parts.set(npcDraft.path, {
      target: applyNpcTarget({ path: npcDraft.path, markdown }),
      open,
      bulk: open,
    });
  }

  let selected: string[];
  if (body.paths === undefined) {
    selected = [...parts].filter(([, part]) => part.bulk).map(([rel]) => rel);
  } else {
    if (!Array.isArray(body.paths)) throw new ApiError(400, "paths must be an array of strings");
    selected = [];
    for (const rel of body.paths) {
      if (typeof rel !== "string") throw new ApiError(400, "paths must be an array of strings");
      const part = parts.get(rel);
      // An unknown path is a client bug worth seeing; an already WRITTEN one
      // is not an error but has nothing left to do (a double click, a second
      // tab) and is simply skipped.
      if (part === undefined) throw new ApiError(400, `unknown draft path: ${rel}`);
      if (part.open) selected.push(rel);
    }
  }
  if (selected.length === 0) throw new ApiError(400, "nothing to apply");

  const targets: ApplyTarget[] = selected.map((rel) => (parts.get(rel) as { target: ApplyTarget }).target);
  // The chapter file comes first — the scenes live inside it. Idempotent:
  // an existing chapter yields null, so only the FIRST partial accept of a
  // new-chapter run actually creates it.
  const chapterFile = await newChapterTarget(campaign, body.chapter, body.chapterTitle);
  if (chapterFile !== null) targets.unshift(chapterFile);

  const drafts = targets.map((t) => {
    const parsed = parseMarkdown(t.markdown, t.rel, 0);
    assertDraftId(parsed.properties.id, t.rel);
    return {
      rel: t.rel,
      address: draftAddress(t.rel, parsed.properties),
      properties: parsed.properties,
      body: parsed.body,
    };
  });

  const written: Record<string, string> = {};
  for (const rel of selected) {
    const draft = drafts.find((d) => d.rel === rel);
    if (draft !== undefined) written[rel] = draft.address;
  }
  let jobDeleted = false;
  await applyDrafts(campaign, drafts, undefined, (tx) => {
    jobDeleted = markWrittenInTx(tx, campaign, jobId, rev, written);
  });
  return { written, jobDeleted };
}

