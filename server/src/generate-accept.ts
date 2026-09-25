// Partial accept of a finished generator run.
//
// Its own module and not part of generator.ts for one reason: it needs both
// the proposal VALIDATION (generator.ts) and the JOB store (generate-jobs.ts),
// and generate-jobs.ts already imports generator.ts to run the pipeline. A
// third module keeps that import graph a tree — the same split db/job-boot.ts
// exists for.

import {
  withNpcChange,
  withSceneChange,
  type LocationProposal,
  type NpcProposal,
  type SceneProposal,
} from "@grimoire/shared";
import { ApiError } from "./api-error";
import { getJob, markWrittenInTx, outlineSceneNumbers } from "./generate-jobs";
import { applyLocationItem, applyNpcItem, applySceneItem, jobChapterTarget } from "./generator";
import { requireCampaign } from "./store/campaigns";
import { sceneRunPos, takeSceneRunStart, type SceneRunStart } from "./store/chapters";
import { writeGenerated, type ScenePlacement } from "./store/generated";

/**
 * Accept PART of a finished run — the accept of one scene, npc or location,
 * and accept-all for whatever is left.
 *
 * The whole-run apply (`applyGenerated`) stays exactly as it was; this is
 * the same write with a selection in front of it and different job
 * bookkeeping behind it:
 *
 *   selection   proposed scenes by id under `scenes`, proposed npcs by id
 *               under `npcs`, proposed locations by id under `locations`. All
 *               three absent is "accept all": every scene that is neither
 *               written nor dropped, plus the npcs and locations the DM
 *               ACCEPTED — an undecided one is not written by a bulk action,
 *               and a rejected one never is. The NPC run's one npc is
 *               written by a bulk action unless it was rejected: it is the
 *               whole run. Naming one explicitly is the one way an
 *               undecided npc or location gets written (the accept action on
 *               its row is the decision).
 *               A SCENE CARRIES WHAT IT NAMES. A scene cannot be written
 *               while its `npcs`/`location` name nothing (ADR #19), so a
 *               selected scene pulls in the run's own npcs and locations for
 *               those ids — every one that is not REJECTED, accepted or
 *               still undecided. Accepting the scene is the decision that
 *               they exist; what the DM threw away stays thrown away, and
 *               the write is then refused and names it.
 *   transaction one, with the conflict checks of the ordinary generator write
 *               (`writeGenerated`: conflicts checked INSIDE it, FTS and
 *               `[[slug]]` reference rows follow because this is that path).
 *   placement   a scene of a pipelined run goes to the run's start plus its
 *               outline number (ADR #27), so the run keeps its outline order
 *               in the chapter however many calls accept it and in whatever
 *               order. The start is the chapter's end at the FIRST scene
 *               accept, taken in that transaction and stored on the job in
 *               the same commit.
 *   job         the written parts are recorded ON the job in that same
 *               commit, and the row is deleted the moment nothing is left
 *               open. Discarding (DELETE …/job) therefore removes only the
 *               open rest — what was written is a row now, not a job.
 */
export async function acceptJobParts(
  campaign: string,
  jobId: string,
  rev: number,
  body: {
    scenes?: unknown;
    npcs?: unknown;
    locations?: unknown;
    chapter?: unknown;
    chapterTitle?: unknown;
  },
): Promise<{
  scenes: string[];
  npcs: string[];
  locations: string[];
  jobDeleted: boolean;
}> {
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
  const dropped = new Set(review.droppedScenes);
  /**
   * Every proposed scene of this run, by its id — with the DM's change
   * applied on top of the model's scene (`withSceneChange`) and checked
   * against the scene's schema like any other scene the accept writes.
   */
  const sceneParts = new Map<string, { scene: SceneProposal; open: boolean; bulk: boolean }>();
  job.result?.scenes.forEach((proposal, index) => {
    const open = !review.writtenScenes.includes(proposal.id) && !dropped.has(proposal.id);
    const change = job.sceneEdits[proposal.id];
    sceneParts.set(proposal.id, {
      scene: applySceneItem(
        change === undefined ? proposal : withSceneChange(proposal, change),
        index,
      ),
      open,
      bulk: open,
    });
  });
  /**
   * Every proposed npc of this run, by its id — with the DM's change applied
   * on top of the model's npc (`withNpcChange`) and checked against the
   * npc's schema like any other npc the accept writes.
   */
  const npcParts = new Map<string, { npc: NpcProposal; open: boolean; bulk: boolean }>();
  const addNpc = (proposal: NpcProposal, index: number, wholeRun: boolean): void => {
    const decision = review.npcs[proposal.id];
    const open = !review.writtenNpcs.includes(proposal.id) && decision !== "rejected";
    const change = job.npcEdits[proposal.id];
    npcParts.set(proposal.id, {
      npc: applyNpcItem(change === undefined ? proposal : withNpcChange(proposal, change), index),
      open,
      bulk: open && (wholeRun || decision === "accepted"),
    });
  };
  job.result?.npcs.forEach((proposal, index) => addNpc(proposal, index, false));
  if (job.npcResult !== undefined) addNpc(job.npcResult.npc, 0, true);
  /** Every proposed location of this run, by its id. */
  const locationParts = new Map<
    string,
    { location: LocationProposal; open: boolean; bulk: boolean }
  >();
  job.result?.locations.forEach((proposal, index) => {
    const decision = review.locations[proposal.id];
    const open = !review.writtenLocations.includes(proposal.id) && decision !== "rejected";
    locationParts.set(proposal.id, {
      location: applyLocationItem(proposal, index),
      open,
      bulk: open && decision === "accepted",
    });
  });

  /**
   * The run's own npcs and locations a scene REFERENCES and the DM has not
   * rejected — see the selection rule above. Read off the scene with the
   * DM's change applied, so an edit of the scene in the review counts.
   */
  const referencedOf = (id: string): { npcs: string[]; locations: string[] } => {
    const part = sceneParts.get(id);
    if (part === undefined) return { npcs: [], locations: [] };
    const { npcs: npcIds, location } = part.scene;
    return {
      npcs: npcIds.filter((npcId) => npcParts.get(npcId)?.open === true),
      locations:
        location !== undefined && locationParts.get(location)?.open === true ? [location] : [],
    };
  };

  /**
   * WHICH parts this call writes. Only membership — the order comes from
   * `sceneParts` below.
   */
  const chosenScenes = new Set<string>();
  const chosenNpcs = new Set<string>();
  const chosenLocations = new Set<string>();
  const bulk = body.scenes === undefined && body.npcs === undefined && body.locations === undefined;
  if (bulk) {
    for (const [id, part] of sceneParts) if (part.bulk) chosenScenes.add(id);
    for (const [id, part] of npcParts) if (part.bulk) chosenNpcs.add(id);
    for (const [id, part] of locationParts) if (part.bulk) chosenLocations.add(id);
  } else {
    // An unknown id is a client bug worth seeing; an already WRITTEN one is
    // not an error but has nothing left to do (a double click, a second tab)
    // and is simply skipped.
    for (const id of stringList(body.scenes, "scenes")) {
      const part = sceneParts.get(id);
      if (part === undefined) throw new ApiError(400, `unknown scene: ${id}`);
      if (part.open) chosenScenes.add(id);
    }
    for (const id of stringList(body.npcs, "npcs")) {
      const part = npcParts.get(id);
      if (part === undefined) throw new ApiError(400, `unknown npc: ${id}`);
      if (part.open) chosenNpcs.add(id);
    }
    for (const id of stringList(body.locations, "locations")) {
      const part = locationParts.get(id);
      if (part === undefined) throw new ApiError(400, `unknown location: ${id}`);
      if (part.open) chosenLocations.add(id);
    }
  }
  for (const id of [...chosenScenes]) {
    const referenced = referencedOf(id);
    for (const id of referenced.npcs) chosenNpcs.add(id);
    for (const id of referenced.locations) chosenLocations.add(id);
  }
  const npcs = [...npcParts].filter(([id]) => chosenNpcs.has(id)).map(([, part]) => part.npc);
  const locations = [...locationParts]
    .filter(([id]) => chosenLocations.has(id))
    .map(([, part]) => part.location);
  /**
   * The selection in the order of `sceneParts`, which is the run's OUTLINE
   * order — the dramaturgical sequence the outline step decided. A scene of
   * a pipelined run is placed by its outline number (`placeScene` below); a
   * scene without one goes to the end of its chapter, and then the write
   * order IS the order the scenes end up in (ADR #27). Either way the chapter
   * does not depend on the order the review happened to name its scenes in.
   *
   * The npcs and locations a selected scene carries along are written ahead
   * of every scene by `writeGenerated`, so they cannot shift a scene's
   * position.
   */
  const scenes = [...sceneParts]
    .filter(([id]) => chosenScenes.has(id))
    .map(([, part]) => part.scene);
  // A selection whose parts are ALL written already is a double click or a
  // second tab, not an error: the caller asked for a state that is the
  // state, so it gets the honest empty answer.
  // Only a BULK accept with nothing open left stays a 400 — there the caller
  // named nothing and there was nothing, which is a client bug.
  if (scenes.length === 0 && npcs.length === 0 && locations.length === 0) {
    if (!bulk) return { scenes: [], npcs: [], locations: [], jobDeleted: false };
    throw new ApiError(400, "nothing to apply");
  }

  // The chapter comes first — the scenes live inside it. Idempotent:
  // an existing chapter yields null, so only the FIRST partial accept of a
  // new-chapter run actually creates it.
  //
  // Decided from the JOB and not from the body: the review state is
  // persistent, so the accept regularly happens in a browser that never saw
  // the start form. The body fields remain an override.
  const newChapter = await jobChapterTarget(campaign, job, body.chapter, body.chapterTitle);
  /**
   * The run's start, stored or — at the first scene accept — taken inside
   * the write transaction. Reading the stored one off the pre-read job is
   * safe: only an accept sets it, every accept bumps the review rev, and
   * `markWrittenInTx` refuses a stale rev in this very transaction.
   */
  let sceneStart: SceneRunStart | undefined = job.pipeline?.sceneStart;
  let tookStart = false;
  const numbers = outlineSceneNumbers(job.pipeline?.parts ?? []);
  const placeScene: ScenePlacement = (tx, scene) => {
    const number = numbers.get(scene.id);
    const chapter = scene.chapter;
    // A scene outside the outline or outside the run's chapter has no place
    // of its own and goes to the end, like every other new scene.
    if (number === undefined || chapter !== job.chapter) return undefined;
    if (sceneStart === undefined) {
      sceneStart = takeSceneRunStart(tx, campaign, chapter);
      tookStart = true;
    }
    return sceneRunPos(tx, campaign, chapter, sceneStart, number);
  };

  const writtenScenes = scenes.map((scene) => scene.id);
  const writtenNpcs = npcs.map((npc) => npc.id);
  const writtenLocations = locations.map((location) => location.id);
  let jobDeleted = false;
  await writeGenerated(campaign, {
    ...(newChapter === null ? {} : { chapter: newChapter }),
    scenes,
    npcs,
    locations,
    runChapters: job.chapter === undefined ? [] : [job.chapter],
    placeScene,
    onWritten: (tx) => {
      jobDeleted = markWrittenInTx(
        tx,
        campaign,
        jobId,
        rev,
        { scenes: writtenScenes, npcs: writtenNpcs, locations: writtenLocations },
        tookStart ? sceneStart : undefined,
      );
    },
  });
  return { scenes: writtenScenes, npcs: writtenNpcs, locations: writtenLocations, jobDeleted };
}

/** A request list of strings, or none; anything else is a 400 naming it. */
function stringList(value: unknown, what: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(400, `${what} must be an array of strings`);
  }
  return value as string[];
}

