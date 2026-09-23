// Partial accept of a finished generator run.
//
// Its own module and not part of generator.ts for one reason: it needs both
// the draft VALIDATION (generator.ts) and the JOB store (generate-jobs.ts),
// and generate-jobs.ts already imports generator.ts to run the pipeline. A
// third module keeps that import graph a tree — the same split db/job-boot.ts
// exists for.

import type { DraftEdit } from "@grimoire/shared";
import { ApiError } from "./api-error";
import {
  draftSceneId,
  getJob,
  markWrittenInTx,
  openPartPaths,
  outlineSceneNumbers,
} from "./generate-jobs";
import {
  applyNpcTarget,
  applySceneTarget,
  applyStubTarget,
  draftAddress,
  jobChapterTarget,
  storedDraftProperties,
  type ApplyTarget,
} from "./generator";
import { locationPath, npcPath } from "./store/paths";
import { requireCampaign } from "./store/campaigns";
import { sceneRunPos, takeSceneRunStart, type SceneRunStart } from "./store/chapters";
import { applyDrafts, type ScenePlacement } from "./store/drafts";

/**
 * Accept PART of a finished run — „Diesen übernehmen" per scene
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
 *               by a bulk action, exactly as before, and a
 *               rejected one never is. Naming a path explicitly is the one
 *               way an undecided entry gets written („Diesen übernehmen"
 *               on its row is the decision).
 *               A SCENE CARRIES THE ENTRIES IT NAMES. A scene cannot be
 *               written while its `npcs`/`location` name nothing (ADR #19),
 *               so a selected scene pulls in the run's own suggested entries
 *               for those ids — every one that is not REJECTED, accepted or
 *               still undecided. A stub is the minimal entry the scene
 *               needs, so accepting the scene is the decision that it
 *               exists; what the DM threw away stays thrown away, and the
 *               write is then refused and names it. This carrying is an
 *               INTERIM step — it keeps a run from failing on its own
 *               references; the intended review walks the parts in
 *               reference order (locations, then npcs, then scenes), so
 *               nothing is written before its targets exist.
 *   transaction one, with the target rev guards of the ordinary draft write
 *               (`applyDrafts`: conflicts checked INSIDE it, FTS and
 *               `[[slug]]` reference rows follow because this is that path).
 *   placement   a scene of a pipelined run goes to the run's start plus its
 *               outline number (ADR #27), so the run keeps its outline order
 *               in the chapter however many calls accept it and in whatever
 *               order. The start is the chapter's end at the FIRST scene
 *               accept, taken in that transaction and stored on the job in
 *               the same commit.
 *   job         the written parts are recorded ON the job in that same
 *               commit, and the row is deleted the moment nothing is left
 *               open. „Verwerfen" (DELETE …/job) therefore removes only the
 *               open rest — what was written is an entry now, not a job.
 */
/**
 * One draft with the DM's review edit applied, half by half: a `properties`
 * edit replaces the whole properties object, a `body` edit the whole body,
 * and the half the edit does not carry keeps the model's own value (see
 * DraftEdit). So a text edit cannot reset a field and a field edit cannot
 * reset the text.
 */
function edit(
  draft: { properties: Record<string, unknown>; body: string },
  edited: DraftEdit | undefined,
): { properties: Record<string, unknown>; body: string } {
  return {
    properties: edited?.properties ?? draft.properties,
    body: edited?.body ?? draft.body,
  };
}

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
  // A RUNNING job is acceptable too, part by part: a
  // pipelined run stays `running` while parts are open, and the whole point
  // of the pipeline is that a finished part is reviewable and acceptable
  // before its siblings are. What is acceptable is what is IN the result, and
  // only a `done` part ever lands there — so the gate asks for a result, not
  // for a finished run. A `failed` job (no part produced anything) and a
  // running one that has not produced anything yet keep their 409.
  if (job.status === "failed") throw new ApiError(409, "this job has no result to accept");
  // A running SINGLE-CALL run (npc, augment) has no parts at all, so this is
  // also what keeps it unacceptable until it is done.
  if (job.status === "running" && !(job.pipeline?.parts ?? []).some((p) => p.status === "done")) {
    throw new ApiError(409, "this job has no finished part to accept");
  }

  const review = job.review;
  const dropped = new Set(review.dropped);
  /** Every part of this run, by the path the review addresses it with. */
  const parts = new Map<string, { target: ApplyTarget; open: boolean; bulk: boolean }>();
  job.result?.scenes.forEach((scene, index) => {
    const edited = edit(scene, job.draftEdits.get(scene.path));
    const open = review.written[scene.path] === undefined && !dropped.has(scene.path);
    parts.set(scene.path, {
      target: applySceneTarget({ path: scene.path, ...edited }, index),
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
      target: applyStubTarget({ ...stub, ...edit(stub, job.draftEdits.get(rel)) }, index),
      open,
      bulk: open && decision === "accepted",
    });
  });
  const npcDraft = job.npcResult?.npc;
  if (npcDraft !== undefined) {
    const edited = edit(npcDraft, job.draftEdits.get(npcDraft.path));
    const open = review.written[npcDraft.path] === undefined;
    parts.set(npcDraft.path, {
      target: applyNpcTarget({ path: npcDraft.path, ...edited }),
      open,
      bulk: open,
    });
  }

  /**
   * The run's own entries a scene REFERENCES and the DM has not rejected —
   * see the selection rule above. Read off the draft's properties, so an
   * edit of the scene in the review counts.
   */
  const scenePaths = new Set(job.result?.scenes.map((scene) => scene.path) ?? []);
  const referencedPartsOf = (rel: string): string[] => {
    const part = parts.get(rel);
    if (part === undefined || !scenePaths.has(rel)) return [];
    const { properties } = part.target;
    const npcIds = Array.isArray(properties.npcs) ? properties.npcs : [];
    const location = properties.location;
    const candidates = [
      ...npcIds.filter((id): id is string => typeof id === "string").map(npcPath),
      ...(typeof location === "string" && location !== "" ? [locationPath(location)] : []),
    ];
    return candidates.filter((candidate) => parts.get(candidate)?.open === true);
  };

  /**
   * WHICH parts this call writes. Only membership — the order comes from
   * `parts` below.
   */
  const chosen = new Set<string>();
  if (body.paths === undefined) {
    for (const [rel, part] of parts) if (part.bulk) chosen.add(rel);
  } else {
    if (!Array.isArray(body.paths)) throw new ApiError(400, "paths must be an array of strings");
    for (const rel of body.paths) {
      if (typeof rel !== "string") throw new ApiError(400, "paths must be an array of strings");
      const part = parts.get(rel);
      // An unknown path is a client bug worth seeing; an already WRITTEN one
      // is not an error but has nothing left to do (a double click, a second
      // tab) and is simply skipped.
      if (part === undefined) throw new ApiError(400, `unknown draft path: ${rel}`);
      if (part.open) chosen.add(rel);
    }
  }
  for (const rel of [...chosen]) {
    for (const referenced of referencedPartsOf(rel)) chosen.add(referenced);
  }
  /**
   * The selection in the order of `parts`, which is the run's OUTLINE order —
   * the dramaturgical sequence the outline step decided. A scene draft of a
   * pipelined run is placed by its outline number (`placeScene` below); a
   * scene without one goes to the end of its chapter (`insertDraft`), and
   * then the write order IS the order the scenes end up in (ADR #27). Either
   * way the chapter does not depend on the order the review happened to name
   * its paths in.
   *
   * The carried-along referenced entries sit at their own outline place here
   * rather than appended at the end: they are parts of this run like any
   * other, and `applyDrafts` sorts every entry ahead of the scenes anyway
   * (`inReferenceOrder`), so appending them would buy no reference safety and
   * only let one scene's references shift another scene's position.
   */
  const selected = [...parts.keys()].filter((rel) => chosen.has(rel));
  // A selection whose parts are ALL written already is a double click or a
  // second tab, not an error: the caller asked for a state that is the
  // state, so it gets the honest empty answer.
  // Only a BULK accept with nothing open left stays a 400 — there the caller
  // named nothing and there was nothing, which is a client bug.
  if (selected.length === 0) {
    if (body.paths !== undefined) return { written: {}, jobDeleted: false };
    throw new ApiError(400, "nothing to apply");
  }

  const targets: ApplyTarget[] = selected.map((rel) => (parts.get(rel) as { target: ApplyTarget }).target);
  // The chapter comes first — the scenes live inside it. Idempotent:
  // an existing chapter yields null, so only the FIRST partial accept of a
  // new-chapter run actually creates it.
  //
  // Decided from the JOB and not from the body: the review state is
  // persistent, so the accept regularly happens in a browser that never saw
  // the start form. The body fields remain an override.
  const chapterEntry = await jobChapterTarget(campaign, job, body.chapter, body.chapterTitle);
  if (chapterEntry !== null) targets.unshift(chapterEntry);

  const drafts = targets.map((t) => {
    const properties = storedDraftProperties(t.properties, t.rel);
    return {
      rel: t.rel,
      address: draftAddress(t.rel, properties),
      properties,
      body: t.body,
    };
  });

  const written: Record<string, string> = {};
  for (const rel of selected) {
    const draft = drafts.find((d) => d.rel === rel);
    if (draft !== undefined) written[rel] = draft.address;
  }
  /**
   * The run's start, stored or — at the first scene accept — taken inside
   * the write transaction. Reading the stored one off the pre-read job is
   * safe: only an accept sets it, every accept bumps the review rev, and
   * `markWrittenInTx` refuses a stale rev in this very transaction.
   */
  let sceneStart: SceneRunStart | undefined = job.pipeline?.sceneStart;
  let tookStart = false;
  const numbers = outlineSceneNumbers(job.pipeline?.parts ?? []);
  const placeScene: ScenePlacement = (tx, rel, chapter) => {
    const number = scenePaths.has(rel) ? numbers.get(draftSceneId(rel)) : undefined;
    // A scene outside the outline or outside the run's chapter has no place
    // of its own and goes to the end, like every other new scene.
    if (number === undefined || chapter !== job.chapter) return undefined;
    if (sceneStart === undefined) {
      sceneStart = takeSceneRunStart(tx, campaign, chapter);
      tookStart = true;
    }
    return sceneRunPos(tx, campaign, chapter, sceneStart, number);
  };

  let jobDeleted = false;
  await applyDrafts(campaign, drafts, {
    placeScene,
    onWritten: (tx) => {
      jobDeleted = markWrittenInTx(
        tx,
        campaign,
        jobId,
        rev,
        written,
        tookStart ? sceneStart : undefined,
      );
    },
  });
  return { written, jobDeleted };
}

