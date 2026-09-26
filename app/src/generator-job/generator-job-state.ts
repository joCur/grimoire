// Pure helpers for the generator view. Everything here is
// derivation and formatting — no fetching, no state:
//
//   - the edits the review keeps on the job: one change per proposed scene
//     and per proposed npc, by id, field by field — merged here exactly the
//     way the server merges them.
//   - the count labels for the context hint and the apply button — out of
//     the catalog, with the translator PASSED IN (a pure helper must not
//     decide which language the UI is in, see i18n/index.ts).
//   - the run's token spend as one quiet line, formatted from
//     whatever the server sent — a successful run and a 422 both carry it.
//   - which of the view's states the server's job puts us in,
//     and the error body of a failed job.

import type {
  GeneratorJob,
  GeneratorJobPart,
  GeneratorJobPatch,
  GeneratorJobReview,
  GenerateReviewDecision,
} from "@grimoire/shared/generator-job";

import type { PartState } from "@/components/ProposalRow";
import type { Translate } from "@/i18n";

/**
 * Summary inside the apply button: "2 scenes · 1 proposed npc or location".
 * One catalog entry per sentence, so the plural of both halves is the
 * message's business (ICU) and nothing is glued together here. `proposed`
 * counts the proposed npcs and locations together.
 */
export function applySummary(sceneCount: number, proposed: number, t: Translate): string {
  return t("generate.review.summary", { scenes: sceneCount, stubs: proposed });
}

/**
 * The context hint under the source textarea: what the server will send along
 * with the prompt (generator/README.md step 1).
 *
 * Only the two COUNTS that come from the tree. The campaign knowledge and the
 * glossary are pages of their own, so they are LINKS, and a link
 * cannot live inside a formatted string without either splitting the pattern
 * or rendering markup out of the catalog. The view composes the line from this
 * half and the two below (routes/generate.tsx).
 */
export function contextHint(npcCount: number, locationCount: number, t: Translate): string {
  return t("generate.input.contextEntities", { npcs: npcCount, locations: locationCount });
}

/**
 * The knowledge half of that line: how many knowledge items travel.
 *
 * The COUNT and not a yes/no like the glossary: the DM comes back here right
 * after writing a rule, and the number of items is what confirms it arrived.
 * Count with `promptKnowledgeCount` (knowledge-item/knowledge-item-draft.ts) —
 * a half-typed convention is stored but skipped by the prompt.
 */
export function knowledgeHint(knowledgeCount: number, t: Translate): string {
  return t("generate.input.knowledgeCount", { count: knowledgeCount });
}

/** Strings out of an error body field (`validationErrors`, `conflicts`). */
export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** One string out of an error body field (`error`, `rawReply`). */
export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Thousands grouping, done by hand: Intl needs full ICU data, and a runtime
 * without it would silently print "12400" instead of "12.400". The separator
 * itself is locale data and therefore comes from the catalog (a dot in
 * German, a comma in English) — the rule does not.
 */
function groupedNumber(n: number, separator: string): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

// --- the view's state, derived from the server's job --------------------

/**
 * The generator view's states. `checking` is the first job lookup on mount —
 * one request, and while it is in flight neither the input form nor a
 * spinner would be honest (a running job would flash the form).
 */
export type GeneratePhase = "checking" | "input" | "working" | "review" | "done";

/**
 * Has the job of the run we just started shown up?
 *
 * The view shows its working state for exactly as long as the
 * answer is no — and THAT is the whole question the stall got wrong. It used
 * the START REQUEST's lifetime instead: while `POST /generate` was in flight
 * the spinner won, even though the job it created was already readable and
 * `done`. With a fast model the run finishes before its own 202 arrives, so
 * the DM sat in front of a finished run for as long as that response took —
 * and when it took long enough, indefinitely. The
 * job is the truth about the run; the request that started it is not.
 *
 * Telling the run's job from the one that was there BEFORE the click needs no
 * response either: the id at the moment of the click is what the new job is
 * NOT (`startJob` replaces the row with a new id). `startedJobId` covers the
 * one case that id cannot decide — a 409 the app ADOPTS hands back the id of
 * the job that is already running, which may well be the one in the cache.
 */
export function runJobArrived(input: {
  /** Id of the job in the cache; null when there is none. */
  jobId: string | null;
  /** Id of the job in the cache when the generate action was clicked. */
  staleJobId: string | null;
  /** The id the start request answered with — a 202's or an adopted 409's. */
  startedJobId?: string;
}): boolean {
  if (input.jobId === null) return false;
  return input.jobId !== input.staleJobId || input.jobId === input.startedJobId;
}

/**
 * Which state the view is in. The server's job decides everything except
 * the two purely local outcomes: an apply that wrote (done) and a start
 * request still in flight (working — the job does not exist yet).
 * A FAILED job belongs to the input state: its error block sits above the
 * form, so the next run is one click away (see jobErrorBody).
 */
export function generatePhase(input: {
  /** An apply wrote drafts — the run is over, whatever the job says. */
  applied: boolean;
  /**
   * A run was started and its OWN job has not shown up yet (runJobArrived).
   * Deliberately not the lifetime of the POST: see runJobArrived.
   */
  starting: boolean;
  /** The job lookup answered at least once (data or error). */
  jobChecked: boolean;
  /** Status of the campaign's job; undefined when there is none. */
  jobStatus?: GeneratorJob["status"];
  /**
   * A RUNNING run already has something to review: at least one part is
   * done, or one has failed and offers its retry action. Both are
   * things the DM can act on, so the view is the review, not the spinner.
   */
  hasParts?: boolean;
}): GeneratePhase {
  if (input.applied) return "done";
  if (input.starting) return "working";
  if (!input.jobChecked) return "checking";
  // A pipelined run reaches the review BEFORE it is finished: the moment one
  // part produced something, that part is reviewable and acceptable while
  // the others are still going. Only a run with
  // nothing to show yet is still the spinner.
  if (input.jobStatus === "running") return input.hasParts === true ? "review" : "working";
  if (input.jobStatus === "done") return "review";
  return "input";
}

// --- generator mode --------------------------------------------------------

/** Which kind of run the generator view is set up for. */
export type GenerateMode = "scene" | "npc";

/**
 * The mode a job belongs to. Anything that is not explicitly an NPC run is a
 * scene run — `kind` is an additive field, so a payload without it (an older
 * server, a job from before the field existed) must not land in NPC mode.
 */
export function jobMode(job: GeneratorJob | null | undefined): GenerateMode {
  return job?.kind === "npc" ? "npc" : "scene";
}

/**
 * Which mode the view shows after the server's job answered: a job that
 * EXISTS decides (its result belongs to its kind — restoring a run must land
 * in the right mode), no job leaves the DM's own choice alone. That
 * asymmetry is the point: applying or discarding an NPC run must not throw
 * the view back to scenes while the DM is still writing NPCs.
 */
export function restoredMode(current: GenerateMode, job: GeneratorJob | null | undefined): GenerateMode {
  return job === null || job === undefined ? current : jobMode(job);
}

/**
 * The error body of a failed job — the same `{ error, validationErrors?,
 * rawReply?, usage? }` shape a generator 422 carries, so the view shows one
 * error block for both. Undefined for every other status, and for a failed
 * job without a body to show.
 */
export function jobErrorBody(
  job: GeneratorJob | null | undefined,
): Record<string, unknown> | undefined {
  if (job === null || job === undefined || job.status !== "failed") return undefined;
  const body = job.error?.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  return body;
}

/**
 * The quiet cost line of one generator run: "~12.400 Tokens · 1 Versuch".
 * Takes the raw value because it comes either from GenerateResult.usage or
 * out of an error body (`ApiError.details.usage`) — undefined whenever the
 * endpoint reported no usage, and then nothing is shown at all.
 */
export function usageLabel(value: unknown, t: Translate): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const tokens = num(usage.inputTokens) + num(usage.outputTokens);
  const attempts = num(usage.attempts);
  if (tokens <= 0 && attempts <= 0) return undefined;
  return t("generate.usage", {
    tokens: groupedNumber(Math.max(tokens, 0), t("generate.usage.group")),
    attempts: Math.max(attempts, 0),
  });
}

// --- the review state on the job -------------------------------------------
//
// Everything the DM does in the review — the edited proposed scenes and npcs,
// the decision per proposed npc and per proposed location, the dropped
// scenes, the per field/block decisions of an augment run — lives on the JOB,
// not in this browser. These are the pure
// halves of that: what the state IS, what a patch does to it, and what is
// still open. No fetching; the hook (./use-job-review.ts) does that.

/** A review state with nothing decided — also the fallback for an older payload. */
export function emptyReview(): GeneratorJobReview {
  return {
    droppedScenes: [],
    fields: {},
    blocks: {},
    writtenScenes: [],
    npcs: {},
    writtenNpcs: [],
    locations: {},
    writtenLocations: [],
  };
}

/** The job's review state, degrading to "nothing decided" when it has none. */
export function reviewOf(job: GeneratorJob | null | undefined): GeneratorJobReview {
  const review = job?.review;
  if (review === undefined) return emptyReview();
  return {
    droppedScenes: review.droppedScenes ?? [],
    fields: review.fields ?? {},
    blocks: review.blocks ?? {},
    writtenScenes: review.writtenScenes ?? [],
    npcs: review.npcs ?? {},
    writtenNpcs: review.writtenNpcs ?? [],
    locations: review.locations ?? {},
    writtenLocations: review.writtenLocations ?? [],
  };
}

/**
 * What one review patch of the job changes — its PATCH without the guard,
 * which the sender adds when it goes out.
 */
export type ReviewPatch = Omit<GeneratorJobPatch, "rev" | "id">;

/**
 * Merge the changes of the proposals PER ID and field by field: a text edit
 * must not drop a field edit that is already on the job, and the other way
 * round. A field the patch names replaces the stored one — `null` included,
 * which clears it on the proposal.
 */
export function mergeEdits<C extends object>(
  into: Record<string, C>,
  patch?: Record<string, C>,
): Record<string, C> {
  const out = { ...into };
  for (const [id, change] of Object.entries(patch ?? {})) {
    out[id] = { ...out[id], ...change };
  }
  return out;
}

/** Merge boolean decisions; `null` deletes the key (the server does this). */
function mergeFlags(
  into: Record<string, boolean>,
  patch?: Record<string, boolean | null>,
): Record<string, boolean> {
  const out = { ...into };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

/** Merge decisions; `null` deletes the key (the server does this). */
function mergeDecisions(
  into: Record<string, GenerateReviewDecision>,
  patch?: Record<string, GenerateReviewDecision | null>,
): Record<string, GenerateReviewDecision> {
  const out = { ...into };
  for (const [key, decision] of Object.entries(patch ?? {})) {
    if (decision === null) delete out[key];
    else out[key] = decision;
  }
  return out;
}

/**
 * The job as it will look once a patch lands — the OPTIMISTIC copy the UI
 * shows while the request is in flight. It must merge exactly the way the
 * server does (generator-jobs.ts `applyReviewPatch`), including the one
 * asymmetry: `droppedScenes` is a set sent whole, everything else merges per key,
 * and a `null` decision — in `npcs`, `locations`, `fields` and `blocks`
 * alike — means that the decision is open again, which deletes the key.
 */
export function mergeReviewPatch(job: GeneratorJob, patch: ReviewPatch): GeneratorJob {
  const review = reviewOf(job);
  const decided = patch.review ?? {};
  return {
    ...job,
    sceneEdits: mergeEdits(job.sceneEdits ?? {}, patch.sceneEdits),
    npcEdits: mergeEdits(job.npcEdits ?? {}, patch.npcEdits),
    review: {
      droppedScenes:
        decided.droppedScenes === undefined
          ? review.droppedScenes
          : [...new Set(decided.droppedScenes)],
      fields: mergeFlags(review.fields, decided.fields),
      blocks: mergeFlags(review.blocks, decided.blocks),
      writtenScenes: review.writtenScenes,
      npcs: mergeDecisions(review.npcs, decided.npcs),
      writtenNpcs: review.writtenNpcs,
      locations: mergeDecisions(review.locations, decided.locations),
      writtenLocations: review.writtenLocations,
    },
  };
}

/**
 * The state of one proposed scene of a run, by its id. A WRITTEN scene is
 * read-only and links to what it became; a dropped one is out of every
 * accept.
 */
export function sceneState(job: GeneratorJob | null | undefined, id: string): PartState {
  const review = reviewOf(job);
  if (review.writtenScenes.includes(id)) return "written";
  if (review.droppedScenes.includes(id)) return "dropped";
  return "open";
}

/**
 * The state of one proposed npc, by its id — read off the npc's own
 * decisions and written list (decisions/resources).
 */
export function npcState(job: GeneratorJob | null | undefined, id: string): PartState {
  const review = reviewOf(job);
  if (review.writtenNpcs.includes(id)) return "written";
  if (review.npcs[id] === "rejected") return "rejected";
  return "open";
}

/**
 * The state of one proposed location, by its id — the same states, read
 * off the location's own decisions and written list.
 */
export function locationState(job: GeneratorJob | null | undefined, id: string): PartState {
  const review = reviewOf(job);
  if (review.writtenLocations.includes(id)) return "written";
  if (review.locations[id] === "rejected") return "rejected";
  return "open";
}

/** The ids of the scenes a run proposes. */
export function jobScenes(job: GeneratorJob | null | undefined): string[] {
  return (job?.result?.scenes ?? []).map((scene) => scene.id);
}

/** The ids of the npcs a run proposes — a scene run's list, or the NPC run's one npc. */
export function jobNpcs(job: GeneratorJob | null | undefined): string[] {
  const ids = (job?.result?.npcs ?? []).map((npc) => npc.id);
  const npc = job?.npcResult?.npc.id;
  if (npc !== undefined) ids.push(npc);
  return ids;
}

/** The ids of the locations a run proposes. */
export function jobLocations(job: GeneratorJob | null | undefined): string[] {
  return (job?.result?.locations ?? []).map((location) => location.id);
}

/**
 * How far a partially accepted run got — the accepted count in the topbar
 * and on the generator page. `total` counts every part the run produced,
 * `written` the ones already accepted; a run nobody has accepted anything of
 * reports 0 and shows no progress at all.
 */
export function jobProgress(job: GeneratorJob | null | undefined): {
  written: number;
  total: number;
} {
  const scenes = jobScenes(job);
  const npcs = jobNpcs(job);
  const locations = jobLocations(job);
  const review = reviewOf(job);
  return {
    written:
      scenes.filter((id) => review.writtenScenes.includes(id)).length +
      npcs.filter((id) => review.writtenNpcs.includes(id)).length +
      locations.filter((id) => review.writtenLocations.includes(id)).length,
    total: scenes.length + npcs.length + locations.length,
  };
}

/**
 * The same count as jobProgress, but measured against ALL parts of the RUN.
 *
 * `jobProgress` counts what the run has PRODUCED, which is the whole truth
 * for a single-call run and only half of it for a pipeline: while parts are
 * still going, their drafts are not in the result yet, so a run of three
 * scenes with two finished and one accepted counted one of two right next to
 * a run progress of two of three. The DM thinks in parts of the run,
 * not in parts that happen to have answered already.
 *
 * `Math.max` because the two counts do not have to agree in the other
 * direction either: a suggested entry the DM accepted is a part of the
 * review without being a part of the outline, and a count above its own
 * total would be worse than the confusion this fixes.
 */
export function acceptProgress(job: GeneratorJob | null | undefined): {
  written: number;
  total: number;
} {
  const progress = jobProgress(job);
  const parts = jobPipelineParts(job);
  if (parts.length === 0) return progress;
  return { written: progress.written, total: Math.max(parts.length, progress.total) };
}

/** The proposed scenes still open, by id. */
export function openScenes(job: GeneratorJob | null | undefined): string[] {
  return jobScenes(job).filter((id) => sceneState(job, id) === "open");
}

/** The proposed npcs still open, by id. */
export function openNpcs(job: GeneratorJob | null | undefined): string[] {
  return jobNpcs(job).filter((id) => npcState(job, id) === "open");
}

/** The proposed locations still open, by id. */
export function openLocations(job: GeneratorJob | null | undefined): string[] {
  return jobLocations(job).filter((id) => locationState(job, id) === "open");
}

/** The proposals an accept names, by entity. */
export interface AcceptSelection {
  scenes?: string[];
  npcs?: string[];
  locations?: string[];
}

/**
 * What accepting the whole run names: every open scene, every open npc and
 * location the DM accepted — an undecided one stays out — and the NPC run's
 * one npc unless it was rejected, because it is the whole run.
 */
export function openSelection(job: GeneratorJob | null | undefined): AcceptSelection {
  const review = reviewOf(job);
  const npcRun = job?.npcResult?.npc.id;
  return {
    scenes: openScenes(job),
    npcs: openNpcs(job).filter((id) => id === npcRun || review.npcs[id] === "accepted"),
    locations: openLocations(job).filter((id) => review.locations[id] === "accepted"),
  };
}

/**
 * What an accept wrote: the ids the answer lists as written that the job it
 * was sent against did not.
 */
export function writtenBy(
  before: GeneratorJob | null | undefined,
  after: GeneratorJob,
): { scenes: string[]; npcs: string[]; locations: string[] } {
  const was = reviewOf(before);
  const added = (previous: string[], now: string[]) => now.filter((id) => !previous.includes(id));
  return {
    scenes: added(was.writtenScenes, after.review.writtenScenes),
    npcs: added(was.writtenNpcs, after.review.writtenNpcs),
    locations: added(was.writtenLocations, after.review.writtenLocations),
  };
}

// --- the pipeline of a scene run -------------------------------------------
//
// The run's parts are what the review is laid out by: a done part renders as
// the draft it produced, a running one as a status card, a failed one as its
// error plus its retry action. The OUTLINE is never here — the server does
// not send it, because it is an internal step and the DM never edits it.

/** The parts of a run, in outline order; empty for a single-call run. */
export function jobPipelineParts(job: GeneratorJob | null | undefined): GeneratorJobPart[] {
  return job?.pipeline?.parts ?? [];
}

/** Is there anything in this run the DM can already look at or act on? */
export function hasReviewableParts(job: GeneratorJob | null | undefined): boolean {
  return jobPipelineParts(job).some((part) => part.status === "done" || part.status === "failed");
}

/** Is any part of the run still waiting or in flight? */
export function partsStillRunning(job: GeneratorJob | null | undefined): boolean {
  return jobPipelineParts(job).some(
    (part) => part.status === "pending" || part.status === "running",
  );
}

/**
 * How far the RUN got, which is a different question from how much of it was
 * accepted (jobProgress). Undefined when
 * the run has no parts or every part is settled: a finished run needs no
 * progress line, it needs its drafts.
 *
 * It counts EVERY part, because that is what the question whether the run is
 * still going is measured against. Counting only the scenes while the line was shown for as
 * long as any part was open froze it at all scenes done for the whole entry
 * half of a run — and that line REPLACES the review's own progress in the
 * header, so the run looked stuck and the accepted count was hidden behind
 * it. The wording follows what is actually counted: scenes only when every
 * part is a scene, parts as soon as suggested entries are among them.
 */
export function pipelineProgress(
  job: GeneratorJob | null | undefined,
  t: Translate,
): string | undefined {
  const parts = jobPipelineParts(job);
  if (parts.length === 0 || !partsStillRunning(job)) return undefined;
  const allScenes = parts.every((part) => part.kind === "scene");
  return t(allScenes ? "generate.pipeline.progress" : "generate.pipeline.progressParts", {
    done: parts.filter((part) => part.status === "done").length,
    total: parts.length,
  });
}

/**
 * What the whole run has cost so far as one quiet line, summed over every
 * part INCLUDING the outline call. Undefined when
 * there is nothing to report; a run that made calls but whose endpoint reports
 * no tokens still shows the call count, because that number is always true.
 */
export function pipelineCostLabel(
  job: GeneratorJob | null | undefined,
  t: Translate,
): string | undefined {
  const totals = job?.pipeline?.totals;
  if (totals === undefined) return undefined;
  const tokens = Math.max(totals.inputTokens + totals.outputTokens, 0);
  const calls = Math.max(totals.calls, 0);
  if (tokens === 0 && calls === 0) return undefined;
  return t("generate.pipeline.cost", {
    tokens: groupedNumber(tokens, t("generate.usage.group")),
    calls,
  });
}
