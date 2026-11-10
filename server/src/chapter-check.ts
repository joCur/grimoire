// The CHAPTER CHECK (decisions/generator): a run on a chapter that finds the
// terms its scenes, npcs and locations write in different ways and proposes
// the fixes. It reads the chapter's scenes, the npcs and locations those
// scenes name, and every npc and location whose `chapter` is this one — the
// ROWS of the check.
//
// Two steps, so a long chapter fits the model:
//
//   1. TERMS — one small call per row names that row's own terms, as the row
//      writes them (generator/check-terms-system-prompt.md). The calls run in
//      parallel, like the parts of a scene run.
//   2. MERGE — one call reads every row's list and names the terms the
//      chapter writes in different ways, each with a description, a kind, a
//      proposed rendering and its variants with the rows they stand in
//      (generator/check-merge-system-prompt.md).
//
// A term the glossary or a naming convention already decides is not asked:
// the rows that write it otherwise are fixed with that rendering right away.
// Every other term waits on the DM in the same terms stage a scene run
// decides its terms in. Once every term is decided, each row that writes one
// of them otherwise is a PART of its own: one call returns operations on
// that row (generator/check-fix-system-prompt.md) — the same operations a
// patch round and an extension reply with, never the row again — and the
// accept writes them as one patch of the row, refused when the row changed
// after the check read it.
//
// A chapter whose rows write every term the same way ends the run with no
// part and no term; nothing is written.

import {
  RUN_TERM_KINDS,
  runTermPlaceSchema,
  runTermSchema,
  type GeneratorJobPart,
  type GenerateUsage,
  type LocationProposal,
  type NpcProposal,
  type RunTerm,
  type RunTermPlace,
  type RunTermVariant,
  type SceneProposal,
} from "@grimoire/shared";
import {
  checkMergeReplySchema,
  checkTermsReplySchema,
  type CheckMergeTerm,
  type CheckRowTerm,
} from "@grimoire/shared/check-reply";
import type { JsonSchema } from "@grimoire/shared/outline-schema";
import { z } from "zod";
import { ApiError } from "./api-error";
import {
  callCounter,
  locationPartKey,
  npcPartKey,
  pooled,
  reportPart,
  scenePartKey,
  termsBlock,
  usageOf,
  type CallCounter,
  type PartOutcome,
  type PartUsage,
  type PipelineSink,
  type SceneContext,
} from "./generate-pipeline";
import {
  ASSET_FILES,
  campaignRefIds,
  collectSceneContext,
  composePrompt,
  loadAsset,
  runPipeline,
} from "./generator";
import { parseJsonReply } from "./json-reply";
import type { GenerateRequest, LLMProvider, ReplySchema } from "./llm-provider";
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
import { promptInline } from "./store/knowledge-items";
import { listLocations, readLocation } from "./store/locations";
import { listNpcs, readNpc } from "./store/npcs";
import { listScenes, readScene } from "./store/scenes";

/**
 * What the job keeps of a check, server-side beside its parts: the rows it
 * read — in the chapter's order, scenes first, then npcs, then locations —
 * and the terms the glossary or a naming convention decides, each with the
 * variants the chapter writes it in. The terms the DM decides stand on the
 * job's terms (`pipeline.terms`).
 */
export const checkRecordSchema = z.strictObject({
  rows: z.array(runTermPlaceSchema),
  decided: z.array(runTermSchema),
});

export type CheckRecord = z.infer<typeof checkRecordSchema>;

/** How the job store follows a check: its parts as every run's, and the check itself. */
export interface CheckSink extends PipelineSink {
  /**
   * The merge is in: the job records the check, the terms that wait on the
   * DM (none when nothing needs deciding) and the fix parts that run right
   * away — none while terms wait, and none for a chapter without a fix.
   */
  checkReady(
    check: CheckRecord,
    terms: RunTerm[],
    parts: GeneratorJobPart[],
    usage: PartUsage,
  ): Promise<void>;
}

/** Everything a fix part needs: the context, the rows and every decided term. */
export interface CheckPlan {
  campaign: string;
  ctx: SceneContext;
  rows: RunTermPlace[];
  /** The decided terms — the ones the glossary decides and the ones the DM decided. */
  terms: RunTerm[];
}

// --- the rows -----------------------------------------------------------------

/** The key of a row — the key of the part that fixes it. */
export function rowKey(row: { kind: PartKind; id: string }): string {
  if (row.kind === "scene") return scenePartKey(row.id);
  if (row.kind === "npc") return npcPartKey(row.id);
  return locationPartKey(row.id);
}

/** A stored row without its guard and its trash mark — what the operations change. */
function withoutGuard<T extends { rev: number; deletedMs?: number }>(
  row: T,
): Omit<T, "rev" | "deletedMs"> {
  const { rev: _rev, deletedMs: _deleted, ...proposal } = row;
  return proposal;
}

/**
 * The rows of a chapter check with each one as it is stored now: the
 * chapter's live scenes in the DM's order, then the npcs and locations those
 * scenes name or whose `chapter` is this one, in the campaign's order.
 */
async function chapterRows(
  campaign: string,
  chapter: string,
): Promise<Array<{ place: RunTermPlace; proposal: Proposal }>> {
  const scenes = (await listScenes(campaign)).filter((scene) => scene.chapter === chapter);
  const npcIds = new Set(scenes.flatMap((scene) => scene.npcs));
  const locationIds = new Set(scenes.flatMap((scene) => (scene.location === undefined ? [] : [scene.location])));
  const npcs = (await listNpcs(campaign)).filter(
    (npc) => npc.chapter === chapter || npcIds.has(npc.id),
  );
  const locations = (await listLocations(campaign)).filter(
    (location) => location.chapter === chapter || locationIds.has(location.id),
  );
  return [
    ...scenes.map((scene) => ({
      place: { kind: "scene" as const, id: scene.id, name: scene.title === "" ? scene.id : scene.title },
      proposal: withoutGuard(scene) as SceneProposal,
    })),
    ...npcs.map((npc) => ({
      place: { kind: "npc" as const, id: npc.id, name: npc.name === "" ? npc.id : npc.name },
      proposal: withoutGuard(npc) as NpcProposal,
    })),
    ...locations.map((location) => ({
      place: {
        kind: "location" as const,
        id: location.id,
        name: location.name === "" ? location.id : location.name,
      },
      proposal: withoutGuard(location) as LocationProposal,
    })),
  ];
}

/** A row as it is stored now, with its version. */
async function storedRow(
  campaign: string,
  row: { kind: PartKind; id: string },
): Promise<{ proposal: Proposal; rev: number }> {
  const stored =
    row.kind === "scene"
      ? await readScene(campaign, row.id)
      : row.kind === "npc"
        ? await readNpc(campaign, row.id)
        : await readLocation(campaign, row.id);
  return { proposal: withoutGuard(stored) as Proposal, rev: stored.rev };
}

// --- the replies ----------------------------------------------------------------

/** A zod schema as a schema the provider forces, under `name`. */
function replyRequest(name: string, schema: z.ZodType): ReplySchema {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema) as JsonSchema;
  return { name, schema: json };
}

/** The errors of a reply that does not read as `schema`, one per issue. */
function replyErrors(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => `${issue.path.join(".") || "reply"}: ${issue.message}`);
}

/**
 * Read the reply of one row's terms call: its terms, trimmed, without an
 * entry that names no wording and without a second entry of the same wording.
 */
export function readRowTerms(
  raw: string,
): { ok: true; result: { terms: CheckRowTerm[] } } | { ok: false; errors: string[] } {
  const parsed = checkTermsReplySchema.safeParse(parseJsonReply(raw)?.value);
  if (!parsed.success) return { ok: false, errors: replyErrors(parsed.error.issues) };
  const seen = new Set<string>();
  const terms: CheckRowTerm[] = [];
  for (const term of parsed.data.terms) {
    const wording = term.wording.trim();
    if (wording === "" || seen.has(wording)) continue;
    seen.add(wording);
    terms.push({ wording, description: term.description.trim(), kind: term.kind });
  }
  return { ok: true, result: { terms } };
}

/**
 * Read the merge reply against the rows the check read: every place a
 * variant names has to be the key of one of them, which is a correction turn
 * otherwise.
 */
export function readMerge(
  raw: string,
  rows: readonly RunTermPlace[],
): { ok: true; result: { terms: CheckMergeTerm[] } } | { ok: false; errors: string[] } {
  const parsed = checkMergeReplySchema.safeParse(parseJsonReply(raw)?.value);
  if (!parsed.success) return { ok: false, errors: replyErrors(parsed.error.issues) };
  const keys = new Set(rows.map(rowKey));
  const errors: string[] = [];
  parsed.data.terms.forEach((term, index) => {
    term.variants.forEach((variant, at) => {
      for (const place of variant.places) {
        if (!keys.has(place)) {
          errors.push(
            `terms[${index}].variants[${at}].places: "${place}" is none of the keys in the prompt`,
          );
        }
      }
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { terms: parsed.data.terms } };
}

// --- what the merge found -----------------------------------------------------

/**
 * Sort the merged terms (decisions/generator): a term the glossary or a naming
 * convention decides — its wording or one of its variants reads like a
 * glossary term or a convention's `from`, ignoring case — is `decided`, with
 * the convention's `to` as its rendering, or the merge's for a glossary term,
 * and only when one of its variants deviates from that rendering. Every other
 * term the chapter writes in at least two ways is `open` and waits on the DM.
 * A second term of the same wording is dropped, and so is a variant without a
 * row; the variants name their rows by kind, id and name.
 */
export function sortTerms(
  merged: readonly CheckMergeTerm[],
  rows: readonly RunTermPlace[],
  ctx: Pick<SceneContext, "glossaryTerms" | "namingRules">,
): { open: RunTerm[]; decided: RunTerm[] } {
  const key = (value: string): string => value.trim().toLowerCase();
  const byKey = new Map(rows.map((row) => [rowKey(row), row]));
  const glossary = new Set(ctx.glossaryTerms.map(key));
  const open: RunTerm[] = [];
  const decided: RunTerm[] = [];
  const seen = new Set<string>();
  for (const term of merged) {
    const wording = term.wording.trim();
    if (wording === "" || seen.has(key(wording))) continue;
    if (!(RUN_TERM_KINDS as readonly string[]).includes(term.kind)) continue;
    seen.add(key(wording));
    const variants = mergedVariants(term.variants, byKey);
    const spellings = [wording, ...variants.map((variant) => variant.wording)].map(key);
    const rule = ctx.namingRules.find((candidate) => spellings.includes(key(candidate.from)));
    const covered = rule !== undefined || spellings.some((spelling) => glossary.has(spelling));
    const rendering = rule?.to.trim() || term.rendering.trim() || wording;
    const sorted: RunTerm = {
      wording,
      description: term.description.trim(),
      kind: term.kind,
      rendering,
      variants,
    };
    if (covered) {
      if (variants.some((variant) => variant.wording !== rendering)) decided.push(sorted);
    } else if (variants.length >= 2) {
      open.push(sorted);
    }
  }
  return { open, decided };
}

/** The variants of a merged term with their rows: one per wording, none without a row. */
function mergedVariants(
  variants: CheckMergeTerm["variants"],
  rows: ReadonlyMap<string, RunTermPlace>,
): RunTermVariant[] {
  const out: RunTermVariant[] = [];
  for (const variant of variants) {
    const wording = variant.wording.trim();
    const places = variant.places
      .map((place) => rows.get(place))
      .filter((place): place is RunTermPlace => place !== undefined);
    if (wording === "" || places.length === 0) continue;
    const same = out.find((candidate) => candidate.wording === wording);
    if (same === undefined) {
      out.push({ wording, places: uniquePlaces(places) });
    } else {
      same.places = uniquePlaces([...same.places, ...places]);
    }
  }
  return out;
}

function uniquePlaces(places: readonly RunTermPlace[]): RunTermPlace[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = rowKey(place);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The variants of a term that deviate from its rendering. */
function deviating(term: RunTerm): RunTermVariant[] {
  return (term.variants ?? []).filter((variant) => variant.wording !== term.rendering);
}

/**
 * The fix parts of a check: every row that writes a decided term in a way
 * that deviates from its rendering, in the order of the rows.
 */
export function fixParts(rows: readonly RunTermPlace[], terms: readonly RunTerm[]): GeneratorJobPart[] {
  const affected = new Set(
    terms.flatMap((term) => deviating(term).flatMap((variant) => variant.places.map(rowKey))),
  );
  return rows
    .filter((row) => affected.has(rowKey(row)))
    .map((row) => ({
      key: rowKey(row),
      kind: row.kind,
      id: row.id,
      existing: true as const,
      title: row.name,
      status: "pending" as const,
      warnings: [],
    }));
}

/**
 * The decided terms as the fix calls carry them (llm-provider TERMS_HEADING):
 * one line per deviating variant, written as its term's rendering
 * (generate-pipeline.ts `termsBlock`).
 */
export function fixBlock(terms: readonly RunTerm[]): string {
  return termsBlock(
    terms.flatMap((term) =>
      deviating(term).map((variant) => ({ ...term, wording: variant.wording })),
    ),
  );
}

/** The rows and their terms as the merge call reads them, under each row's key. */
export function rowTermsBlock(
  lists: ReadonlyArray<{ place: RunTermPlace; terms: readonly CheckRowTerm[] }>,
): string {
  return lists
    .filter((list) => list.terms.length > 0)
    .map((list) =>
      [
        `### ${rowKey(list.place)} — ${promptInline(list.place.name)}`,
        ...list.terms.map((term) => {
          const description = promptInline(term.description);
          return (
            `- „${promptInline(term.wording)}“ (${term.kind})` +
            (description === "" ? "" : `: ${description}`)
          );
        }),
      ].join("\n"),
    )
    .join("\n\n");
}

// --- the calls ----------------------------------------------------------------

/** What every call of a check shares: the knowledge, the glossary and the context lists. */
function sharedRequest(ctx: SceneContext): Pick<GenerateRequest, "knowledge" | "glossary" | "context" | "sourceText"> {
  return {
    knowledge: ctx.knowledge,
    glossary: ctx.glossary,
    context: { chapter: ctx.chapter, npcs: ctx.npcs, locations: ctx.locations },
    sourceText: "",
  };
}

/** Sum a call's usage into the check's. */
function addUsage(into: PartUsage, usage: PartUsage): void {
  into.inputTokens += usage.inputTokens;
  into.outputTokens += usage.outputTokens;
  into.calls += usage.calls;
}

/** Step 1: one row's own terms, as it writes them. */
async function rowTerms(
  ctx: SceneContext,
  row: { place: RunTermPlace; proposal: Proposal },
  provider: LLMProvider,
): Promise<{ terms: CheckRowTerm[]; usage: PartUsage }> {
  const counter = callCounter();
  const result = await runPipeline<{ terms: CheckRowTerm[]; usage?: GenerateUsage }>({
    req: {
      systemPrompt: await composePrompt([ASSET_FILES.checkTerms.systemPrompt]),
      fewShotTarget: await loadAsset(ASSET_FILES.checkTerms.fewShotTarget),
      ...sharedRequest(ctx),
      checkedRow: { key: rowKey(row.place), form: replyForm(row.place.kind, row.proposal) },
      jsonSchema: replyRequest("chapter_check_terms", checkTermsReplySchema),
    },
    provider,
    validate: readRowTerms,
    correctionTail: "alle Begriffe des Textes enthalten",
    onCall: counter.onCall,
  });
  return { terms: result.terms, usage: usageOf(result.usage, counter.count()) };
}

/** Step 2: the terms the chapter writes in different ways, out of every row's list. */
async function mergeTerms(
  ctx: SceneContext,
  lists: ReadonlyArray<{ place: RunTermPlace; terms: readonly CheckRowTerm[] }>,
  provider: LLMProvider,
): Promise<{ terms: CheckMergeTerm[]; usage: PartUsage }> {
  const counter = callCounter();
  const rows = lists.map((list) => list.place);
  const result = await runPipeline<{ terms: CheckMergeTerm[]; usage?: GenerateUsage }>({
    req: {
      systemPrompt: await composePrompt([ASSET_FILES.checkMerge.systemPrompt]),
      fewShotTarget: await loadAsset(ASSET_FILES.checkMerge.fewShotTarget),
      ...sharedRequest(ctx),
      checkTerms: rowTermsBlock(lists),
      jsonSchema: replyRequest("chapter_check_merge", checkMergeReplySchema),
    },
    provider,
    validate: (raw) => readMerge(raw, rows),
    correctionTail: "alle Begriffe enthalten",
    onCall: counter.onCall,
  });
  return { terms: result.terms, usage: usageOf(result.usage, counter.count()) };
}

/**
 * One fix part: the row as it is stored now and every decided term, and the
 * call replies with operations on that row. What they would change are the
 * part's changes, beside the row version the call read; what cannot be
 * applied is a finding (./patch-operations.ts). Nothing is written here.
 */
export async function runFixPart(
  plan: CheckPlan,
  part: Pick<GeneratorJobPart, "kind" | "id">,
  provider: LLMProvider,
  counter: CallCounter = callCounter(),
): Promise<{ outcome: PartOutcome; usage: PartUsage }> {
  const kind = part.kind;
  const { proposal, rev } = await storedRow(plan.campaign, part);
  const [systemPrompt, fewShotTarget] = await Promise.all([
    composePrompt([ASSET_FILES.checkFix.systemPrompt, ENTITY[kind].fields]),
    loadAsset(ASSET_FILES.checkFix.fewShotTarget),
  ]);
  const result = await runPipeline<{ operations: ReadOperation[]; usage?: GenerateUsage }>({
    req: {
      systemPrompt,
      fewShotTarget,
      ...sharedRequest(plan.ctx),
      terms: fixBlock(plan.terms),
      checkedRow: { key: rowKey(part), form: replyForm(kind, proposal) },
      jsonSchema: patchReplyRequest(kind),
    },
    provider,
    validate: (raw) => readPatchReply(raw, kind),
    correctionTail: "alle Angleichungen enthalten",
    onCall: counter.onCall,
  });
  const { changes, notes, findings } = applyPatchOperations(kind, proposal, result.operations, {
    chapter: plan.ctx.chapter,
    npcIds: plan.ctx.npcIds,
    locationIds: plan.ctx.locationIds,
    refIds: campaignRefIds(plan.ctx),
  });
  const extension: PartOutcome["extension"] =
    kind === "scene"
      ? { kind, id: part.id, current: proposal as SceneProposal, changes, rev }
      : kind === "npc"
        ? { kind, id: part.id, current: proposal as NpcProposal, changes, rev }
        : { kind, id: part.id, current: proposal as LocationProposal, changes, rev };
  return {
    outcome: { extension, warnings: notes, serverNotes: [], namingHints: [], findings },
    usage: usageOf(result.usage, counter.count()),
  };
}

/** Run the fix parts, at most PART_CONCURRENCY at once; a failure never stops a sibling. */
export async function runFixParts(
  plan: CheckPlan,
  parts: readonly GeneratorJobPart[],
  provider: LLMProvider,
  sink: PipelineSink,
): Promise<void> {
  await pooled(
    parts,
    () => sink.cancelled(),
    (part) => reportPart(part, sink, (counter) => runFixPart(plan, part, provider, counter)),
  );
}

/** The plan of a stored check — what its fix parts and a retry run with. */
export async function replanCheck(input: {
  campaign: string;
  chapter: string;
  check: CheckRecord;
  terms: readonly RunTerm[];
}): Promise<CheckPlan> {
  return {
    campaign: input.campaign,
    ctx: await collectSceneContext(input.campaign, input.chapter),
    rows: input.check.rows,
    terms: [...input.terms],
  };
}

/**
 * The whole check: every row's terms, their merge, and — when nothing waits
 * on the DM — the fix parts. Writes NOTHING into the campaign: what the check
 * finds lands in the job, and only the accept touches the rows.
 */
export async function runChapterCheck(input: {
  campaign: string;
  chapter: string;
  sink: CheckSink;
  provider: LLMProvider;
}): Promise<void> {
  const { campaign, chapter, sink, provider } = input;
  const ctx = await collectSceneContext(campaign, chapter);
  const rows = await chapterRows(campaign, chapter);
  const usage: PartUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const found = await pooled(rows, () => sink.cancelled(), (row) => rowTerms(ctx, row, provider));
  if (sink.cancelled()) return;
  const lists = rows.map((row, index) => {
    const result = found[index];
    if (result === undefined) throw new ApiError(500, "a row of the check was not read");
    addUsage(usage, result.usage);
    return { place: row.place, terms: result.terms };
  });
  const places = rows.map((row) => row.place);
  let merged: CheckMergeTerm[] = [];
  if (lists.some((list) => list.terms.length > 0)) {
    const merge = await mergeTerms(ctx, lists, provider);
    addUsage(usage, merge.usage);
    merged = merge.terms;
  }
  if (sink.cancelled()) return;
  const { open, decided } = sortTerms(merged, places, ctx);
  const check: CheckRecord = { rows: places, decided };
  // Terms that wait on the DM hold every fix back: a row is fixed once, with
  // every term decided (generator-jobs.ts `confirmJobTerms`).
  const parts = open.length === 0 ? fixParts(places, decided) : [];
  await sink.checkReady(check, open, parts, usage);
  if (parts.length === 0) return;
  await runFixParts({ campaign, ctx, rows: places, terms: decided }, parts, provider, sink);
}
