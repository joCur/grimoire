// The PATCH ROUND on a finished part of a scene run (decisions/generator: an
// answer to a note patches the proposal instead of writing it again).
//
// The DM answers the model's notes on one scene, npc or location of the run.
// ONE call per part and round takes the proposal as it stands — the DM's edits
// applied — with those notes and answers, and replies with a list of
// operations (@grimoire/shared/patch-reply): `set` a field, `replace`,
// `insertAfter` or `remove` one block of `body` named by its text, or a
// `note`. The mechanics are every call's (./generator.ts `runPipeline`): same
// provider, same correction turns, same truncation fail-fast, and the call
// joins the run's token counter.
//
// The server applies the operations DETERMINISTICALLY and never trusts them
// (./patch-operations.ts): an anchor that does not hit exactly one block and a
// value the field refuses are not applied; each becomes a finding, which is
// data the app says in the DM's language.
//
// What survives is a list of CHANGES on the part's round, each decided by the
// DM on its own: taking one writes it into the job's edits of that proposal
// (`sceneEdits`, `npcEdits`, `locationEdits`), which the accept applies like
// any other edit. A taken block change is applied to the proposal's text as it
// stands at that moment, so a text the DM edited in between keeps that edit.
//
// An answer the DM keeps as campaign knowledge becomes a `fact` item when the
// round opens, in the same transaction; the round's call reads its context
// after that, so the item is already in this call's knowledge block.

import {
  withLocationChange,
  withNpcChange,
  withSceneChange,
  type GenerateUsage,
  type LocationProposal,
  type NpcProposal,
  type PartAnswer,
  type PartAnswerRequest,
  type SceneProposal,
} from "@grimoire/shared";
import { applyBodyOperation } from "@grimoire/shared/body-patch";
import { ApiError } from "./api-error";
import {
  callCounter,
  failureOf,
  outlineBlock,
  replanStoredRun,
  usageOf,
} from "./generate-pipeline";
import { ASSET_FILES, composePrompt, loadAsset, runPipeline } from "./generator";
import {
  assertAnswerable,
  decidePartRound,
  openPartRound,
  requireJob,
  settlePartRound,
  type Job,
  type StoredPart,
} from "./generator-jobs";
import type { LLMProvider } from "./llm-provider";
import {
  ENTITY,
  applyPatchOperations,
  patchReplyRequest,
  readPatchReply,
  replyForm,
  type PartKind,
  type Proposal,
  type ReadOperation,
} from "./patch-operations";

/** The correction turn's tail — what a corrected reply must still contain. */
const CORRECTION_TAIL = "alle Änderungen enthalten";

// --- the proposal a part stands for ---------------------------------------------

/**
 * The proposal of a part as the review shows it: the model's, with the DM's
 * edits of it applied. Undefined when the run holds none under that id.
 */
export function partProposal(job: Job, part: StoredPart): Proposal | undefined {
  if (part.kind === "scene") {
    const scene = job.result?.scenes.find((candidate) => candidate.id === part.id);
    const change = job.sceneEdits[part.id];
    if (scene === undefined) return undefined;
    return change === undefined ? scene : (withSceneChange(scene, change) as SceneProposal);
  }
  if (part.kind === "npc") {
    const npc = job.result?.npcs.find((candidate) => candidate.id === part.id);
    const change = job.npcEdits[part.id];
    if (npc === undefined) return undefined;
    return change === undefined ? npc : (withNpcChange(npc, change) as NpcProposal);
  }
  const location = job.result?.locations.find((candidate) => candidate.id === part.id);
  const change = job.locationEdits[part.id];
  if (location === undefined) return undefined;
  return change === undefined ? location : (withLocationChange(location, change) as LocationProposal);
}

// --- the round ------------------------------------------------------------------

/** The part of the job under `key` — the job's pipeline is there, the route checked it. */
function storedPart(job: Job, key: string): StoredPart {
  const part = job.pipeline?.parts.find((candidate) => candidate.key === key);
  if (part === undefined) throw new ApiError(404, `unknown part: ${key}`);
  return part;
}

/**
 * Start a patch round on a finished part: the DM's `answers` to its notes go
 * to the model with the proposal as it stands, and the round runs in the
 * background — the answer is the job with the round `running`.
 *
 * 404 without a job under this id or for an unknown part; 400 without an
 * answer; 409 for a part that is not done, whose proposal is written, dropped
 * or rejected, that has a round running or changes to decide, and a stale
 * guard or a note that is not on the part any more is the job's 409.
 */
export async function startPartRound(
  campaign: string,
  jobId: string,
  key: string,
  rev: number,
  answers: readonly PartAnswerRequest[],
  provider: LLMProvider,
): Promise<Job> {
  const sent = dedupe(
    answers
      .map((entry) => ({ ...entry, answer: entry.answer.trim() }))
      .filter((entry) => entry.answer !== ""),
  );
  if (sent.length === 0) throw new ApiError(400, "a round needs at least one answer");
  const given: PartAnswer[] = sent.map(({ note, answer }) => ({ note, answer }));
  // A knowledge item is one line (routes/knowledge-items.ts), so an answer
  // kept as knowledge keeps its words and loses its line breaks.
  const knowledge = sent
    .filter((entry) => entry.asKnowledge === true)
    .map((entry) => entry.answer.replace(/\s+/gu, " "));
  const prejob = await requireJob(campaign, jobId);
  // Checked here so a 404/409 costs no read; binding inside the transaction
  // that opens the round.
  assertAnswerable(
    prejob,
    key,
    rev,
    given.map((entry) => entry.note),
  );
  // The guard below makes the proposal read here the one the round opens on:
  // nothing changes a job's edits without moving its `rev`.
  const proposal = partProposal(prejob, storedPart(prejob, key));
  if (proposal === undefined) throw new ApiError(409, "this part has no proposal to patch");
  const job = await openPartRound(campaign, jobId, key, rev, given, knowledge);
  const part = storedPart(job, key);
  void runRound({ job, part, proposal, answers: given, provider });
  return job;
}

/** One answer per note — the last one the DM gave for it. */
function dedupe(answers: PartAnswerRequest[]): PartAnswerRequest[] {
  const byNote = new Map<string, PartAnswerRequest>();
  for (const entry of answers) byNote.set(entry.note, entry);
  return [...byNote.values()];
}

/** The system prompt of a patch call: the patch rule, then the fields of the part's entity. */
function patchSystemPrompt(kind: PartKind): Promise<string> {
  return composePrompt([ASSET_FILES.patch.systemPrompt, ENTITY[kind].fields]);
}

/**
 * The call of one round and its outcome on the part. The context is read
 * once the round is open, so it holds what opening it wrote — an answer kept
 * as campaign knowledge is in this call's knowledge block. Catches
 * everything: a round that brings nothing fails on its part, and a failure to
 * record even that is logged — the next boot fails the round like every call
 * in flight.
 */
async function runRound(input: {
  job: Job;
  part: StoredPart;
  proposal: Proposal;
  answers: PartAnswer[];
  provider: LLMProvider;
}): Promise<void> {
  const { job, part, proposal } = input;
  const campaign = job.campaign;
  const jobId = job.id;
  const counter = callCounter();
  try {
    const plan = await replanStoredRun({
      campaign,
      chapter: job.chapter!,
      sourceText: job.sourceText ?? "",
      newChapter: job.newChapter,
      outline: job.pipeline!.outline!,
    });
    const [systemPrompt, fewShotTarget] = await Promise.all([
      patchSystemPrompt(part.kind),
      loadAsset(ASSET_FILES.patch.fewShotTarget),
    ]);
    const result = await runPipeline<{ operations: ReadOperation[]; usage?: GenerateUsage }>({
      req: {
        systemPrompt,
        fewShotTarget,
        knowledge: plan.ctx.knowledge,
        glossary: plan.ctx.glossary,
        context: { chapter: plan.ctx.chapter, npcs: plan.ctx.npcs, locations: plan.ctx.locations },
        outline: outlineBlock(plan.outline),
        proposal: replyForm(part.kind, proposal),
        answers: input.answers,
        sourceText: "",
        jsonSchema: patchReplyRequest(part.kind),
      },
      provider: input.provider,
      validate: (raw) => readPatchReply(raw, part.kind),
      correctionTail: CORRECTION_TAIL,
      onCall: counter.onCall,
    });
    const { changes, notes, findings } = applyPatchOperations(part.kind, proposal, result.operations, {
      chapter: plan.ctx.chapter,
      ...plan.allowed,
    });
    await settlePartRound(campaign, jobId, part.key, {
      status: "done",
      changes,
      notes,
      findings,
      usage: usageOf(result.usage, counter.count()),
    });
  } catch (err) {
    const failure = failureOf(err, counter.count());
    try {
      await settlePartRound(campaign, jobId, part.key, {
        status: "failed",
        error: failure.error,
        usage: failure.usage,
      });
    } catch (settleErr) {
      console.error("could not record the failed patch round", settleErr);
    }
  }
}

// --- deciding the changes ---------------------------------------------------------

/**
 * The DM takes or keeps changes of a part's round, by id. A taken change is
 * written into the job's edits of the part's proposal: a field as its new
 * value, a block change applied to the proposal's text as it stands now.
 * A block that is no longer there exactly once is 409 `patch_anchor_missing`
 * with the job, and nothing is written.
 */
export async function decidePartChanges(
  campaign: string,
  jobId: string,
  key: string,
  rev: number,
  decisions: Record<string, "taken" | "kept">,
): Promise<Job> {
  return decidePartRound(campaign, jobId, key, rev, decisions, (job, part, change) => {
    const proposal = partProposal(job, part);
    if (proposal === undefined) return false;
    const edits: Record<string, Record<string, unknown>> =
      part.kind === "scene" ? job.sceneEdits : part.kind === "npc" ? job.npcEdits : job.locationEdits;
    if (change.op === "set") {
      edits[part.id] = { ...edits[part.id], [change.field]: change.value };
      return true;
    }
    const { id: _id, block: _block, ...operation } = change;
    const applied = applyBodyOperation(proposal.body, operation);
    if (!applied.ok) return false;
    edits[part.id] = { ...edits[part.id], body: applied.body };
    return true;
  });
}
