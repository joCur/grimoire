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
// The server applies the operations DETERMINISTICALLY and never trusts them:
//
//   anchors  a block operation hits exactly one block of the proposal the
//            model saw (@grimoire/shared/body-patch), and every other byte of
//            the body stays as it is. An anchor that hits nothing or several
//            blocks is not applied; it becomes a finding that carries it.
//   fields   a `set` is read into the proposal's own form and checked against
//            the entity's schema and against what the run may name; an
//            invalid value is not applied and becomes a finding. A `set` that
//            changes nothing is no change.
//
// A finding is data (`PatchFinding`), never a sentence: the app says it in
// the DM's language. The model's own `note` operations are its notes, free
// text like its `warnings`.
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

import { z } from "zod";
import {
  locationChangeSchema,
  locationFromReply,
  locationPatchReplySchema,
  locationToReply,
  npcChangeSchema,
  npcFromReply,
  npcPatchReplySchema,
  npcToReply,
  sceneChangeSchema,
  sceneFromReply,
  scenePatchReplySchema,
  sceneToReply,
  withLocationChange,
  withNpcChange,
  withSceneChange,
  type GenerateUsage,
  type LocationProposal,
  type LocationReplyFields,
  type LocationReplyObject,
  type NpcProposal,
  type NpcReplyFields,
  type NpcReplyObject,
  type PartAnswer,
  type PartAnswerRequest,
  type PartChange,
  type PatchFinding,
  type SceneProposal,
  type SceneReplyFields,
  type SceneReplyObject,
} from "@grimoire/shared";
import { applyBodyOperation, findAnchor, type BodyOperation, type BodyPatchFailure } from "@grimoire/shared/body-patch";
import type { PatchOperation, PatchReplySchema } from "@grimoire/shared/patch-reply";
import type { JsonSchema } from "@grimoire/shared/outline-schema";
import { ApiError } from "./api-error";
import {
  callCounter,
  failureOf,
  outlineBlock,
  replanStoredRun,
  usageOf,
} from "./generate-pipeline";
import { bodyRefSlugs } from "@grimoire/shared/refs";
import { ASSET_FILES, composePrompt, loadAsset, runPipeline, unknownCallouts } from "./generator";
import { sameValue } from "./generator-augment";
import {
  assertAnswerable,
  decidePartRound,
  openPartRound,
  requireJob,
  settlePartRound,
  type Job,
  type StoredPart,
} from "./generator-jobs";
import { parseJsonReply } from "./json-reply";
import type { LLMProvider, ReplySchema } from "./llm-provider";

type PartKind = StoredPart["kind"];

/** A proposal of a scene run, whatever its entity. */
type Proposal = SceneProposal | NpcProposal | LocationProposal;

/** What a patch call of each entity is forced into and told about its fields. */
const ENTITY: Record<
  PartKind,
  {
    reply: PatchReplySchema;
    replyName: string;
    change: z.ZodObject;
    /** The prompt file that describes the entity's fields. */
    fields: string;
  }
> = {
  scene: {
    reply: scenePatchReplySchema,
    replyName: "scene_patch",
    change: sceneChangeSchema,
    fields: ASSET_FILES.scene.fields,
  },
  npc: {
    reply: npcPatchReplySchema,
    replyName: "npc_patch",
    change: npcChangeSchema,
    fields: ASSET_FILES.npc.fields,
  },
  location: {
    reply: locationPatchReplySchema,
    replyName: "location_patch",
    change: locationChangeSchema,
    fields: ASSET_FILES.location.fields,
  },
};

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

/** A proposal in its entity's reply form — how the prompt shows it. */
function replyForm(
  kind: PartKind,
  proposal: Proposal,
): SceneReplyFields | NpcReplyFields | LocationReplyFields {
  if (kind === "scene") return sceneToReply(proposal as SceneProposal);
  if (kind === "npc") return npcToReply(proposal as NpcProposal);
  return locationToReply(proposal as LocationProposal);
}

/** A reply form back as the proposal it stands for. */
function fromReplyForm(kind: PartKind, form: Record<string, unknown>): Record<string, unknown> {
  const reply = { ...form, warnings: [] };
  if (kind === "scene") return sceneFromReply(reply as unknown as SceneReplyObject).scene;
  if (kind === "npc") return npcFromReply(reply as unknown as NpcReplyObject).npc;
  return locationFromReply(reply as unknown as LocationReplyObject).location;
}

// --- reading the reply ----------------------------------------------------------

/** One operation of a reply as the server read it — or one it could not read. */
export type ReadOperation = { ok: true; operation: PatchOperation } | { ok: false };

/** The schema a patch call is forced into, under the name of its entity. */
function patchReplyRequest(kind: PartKind): ReplySchema {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(ENTITY[kind].reply) as JsonSchema;
  return { name: ENTITY[kind].replyName, schema };
}

/**
 * Read a patch reply. The envelope is the contract — an object with its list
 * of `operations`, or a correction turn. An operation that does not read as
 * one of the entity's operations is kept as unreadable: it costs that
 * operation, never the round.
 */
export function readPatchReply(
  raw: string,
  kind: PartKind,
): { ok: true; result: { operations: ReadOperation[] } } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  const value = parsed?.value;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as Record<string, unknown>).operations)
  ) {
    return {
      ok: false,
      errors: ['reply must be a JSON object with an "operations" array'],
    };
  }
  const item = ENTITY[kind].reply.shape.operations.element;
  const operations = ((value as Record<string, unknown>).operations as unknown[]).map(
    (entry): ReadOperation => {
      const read = item.safeParse(entry);
      return read.success ? { ok: true, operation: read.data } : { ok: false };
    },
  );
  return { ok: true, result: { operations } };
}

// --- applying the operations ------------------------------------------------------

/** What the run may name — the context of the part's checks. */
export interface PatchScope {
  /** The run's chapter: a scene stays in it. */
  chapter: string;
  npcIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
  refIds: ReadonlySet<string>;
}

/** The finding an operation earns when its block cannot be changed. */
function anchorFinding(reason: BodyPatchFailure, anchor: string): PatchFinding {
  if (reason === "ambiguous") return { kind: "anchor_ambiguous", anchor };
  if (reason === "empty") return { kind: "text_empty", anchor };
  return { kind: "anchor_missing", anchor };
}

/** Why a new value of `field` cannot stand, or undefined when it can. */
function fieldFinding(
  kind: PartKind,
  field: string,
  value: unknown,
  scope: PatchScope,
): PatchFinding | undefined {
  const schema = ENTITY[kind].change.shape[field] as z.ZodType | undefined;
  if (schema === undefined || field === "id" || field === "body") {
    return { kind: "field_unknown", field };
  }
  if (value === "" || (value === null && !schema.safeParse(null).success)) {
    return { kind: "field_empty", field };
  }
  if (!schema.safeParse(value).success) return { kind: "field_invalid", field };
  if (kind !== "scene") return undefined;
  if (field === "chapter" && value !== scope.chapter) {
    return { kind: "chapter_outside", chapter: scope.chapter };
  }
  if (field === "location" && typeof value === "string" && !scope.locationIds.has(value)) {
    return { kind: "ids_unknown", field, ids: [value] };
  }
  if (field === "npcs" && Array.isArray(value)) {
    const unknown = value.filter((npc) => typeof npc !== "string" || !scope.npcIds.has(npc));
    if (unknown.length > 0) return { kind: "ids_unknown", field, ids: unknown.map(String) };
  }
  return undefined;
}

/** A value as the reply form holds it, with its text trimmed. */
function trimmed(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "");
  }
  return value;
}

/**
 * Turn the operations of a reply into the round's changes, the model's notes
 * and the findings, against the proposal the model saw. Every operation is
 * judged on its own against that proposal; nothing here writes anything.
 */
export function applyPatchOperations(
  kind: PartKind,
  proposal: Proposal,
  operations: readonly ReadOperation[],
  scope: PatchScope,
): { changes: PartChange[]; notes: string[]; findings: PatchFinding[] } {
  const changes: PartChange[] = [];
  const notes: string[] = [];
  const findings: PatchFinding[] = [];
  const nextId = () => `c${changes.length + 1}`;
  const form: Readonly<Record<string, unknown>> = replyForm(kind, proposal);
  const current = proposal as Record<string, unknown>;
  for (const read of operations) {
    if (!read.ok) {
      findings.push({ kind: "unreadable" });
      continue;
    }
    const operation = read.operation;
    if (operation.op === "note") {
      const text = operation.text.trim();
      if (text !== "" && !notes.includes(text)) notes.push(text);
      continue;
    }
    if (operation.op === "set") {
      const { field } = operation;
      const raw = trimmed(operation.value);
      // A blank text is "not given" in the reply form, like in every reply.
      const clearable = (ENTITY[kind].change.shape[field] as z.ZodType | undefined)?.safeParse(
        null,
      ).success;
      const given = raw === "" && clearable === true ? null : raw;
      const value = fromReplyForm(kind, { ...form, [field]: given })[field] ?? null;
      const finding = fieldFinding(kind, field, value, scope);
      if (finding !== undefined) {
        findings.push(finding);
        continue;
      }
      if (sameValue(current[field], value)) continue;
      changes.push({ id: nextId(), op: "set", field, value });
      continue;
    }
    const outcome = bodyChange(proposal.body, operation, scope);
    if (outcome.ok) changes.push({ id: nextId(), ...outcome.change });
    else findings.push(...outcome.findings);
  }
  return { changes, notes, findings };
}

/** One block operation, checked against the body the model saw. */
function bodyChange(
  body: string,
  operation: BodyOperation,
  scope: PatchScope,
):
  | { ok: true; change: BodyOperation & { block: string } }
  | { ok: false; findings: PatchFinding[] } {
  const applied = applyBodyOperation(body, operation);
  if (!applied.ok) return { ok: false, findings: [anchorFinding(applied.reason, operation.anchor)] };
  if (operation.op !== "remove") {
    const { anchor, text } = operation;
    const callouts = unknownCallouts(text);
    const ids = bodyRefSlugs(text).filter((id) => !scope.refIds.has(id));
    const findings: PatchFinding[] = [
      ...(callouts.length === 0 ? [] : [{ kind: "callouts_unknown" as const, anchor, callouts }]),
      ...(ids.length === 0 ? [] : [{ kind: "refs_unknown" as const, anchor, ids: [...new Set(ids)] }]),
    ];
    if (findings.length > 0) return { ok: false, findings };
  }
  const found = findAnchor(body, operation.anchor);
  const block = found.ok ? found.markdown : operation.anchor;
  return { ok: true, change: { ...operation, block } };
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
