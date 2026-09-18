// Pure helpers for the generator view. Everything here is
// derivation and formatting — no fetching, no state:
//
//   - the "Neues Kapitel" flow needs a chapter id BEFORE anything exists:
//     the next free numeric prefix from the tree plus a kebab slug of the
//     title (the path preview shows exactly what apply will create). Since
//     that preview is an editable field: the suggestion is only a
//     suggestion, the DM may name the directory freely — so the id also
//     needs a client-side check (chapterIdError) and the rule for when the
//     suggestion still follows the title (chapterIdValue).
//   - the edits the review keeps on the job: one record per draft path, each
//     half (properties, body) a whole replacement of what the run produced,
//     merged here exactly the way the server merges them.
//   - the count labels for the context hint and the apply button — from the
//     out of the catalog, with the translator PASSED IN (the lib layer
//     must not decide which language the UI is in, see i18n/index.ts).
//   - the run's token spend as one quiet line, formatted from
//     whatever the server sent — a successful run and a 422 both carry it.
//   - which of the view's states the server's job puts us in,
//     and the error body of a failed job.

import type {
  DraftEdit,
  GenerateJob,
  GenerateJobPart,
  GenerateJobReview,
  GenerateReviewDecision,
} from "@grimoire/shared/types";

import type { Translate } from "@/i18n";

/** German umlauts/ß first — NFKD would strip them to bare vowels. */
const UMLAUTS: Array<[RegExp, string]> = [
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"],
];

/**
 * Kebab-case slug of a chapter title, mirroring the ids in the data format
 * (README: `01-salzhafen`): lowercase ASCII words joined by single dashes.
 * Returns "" when the title has no usable characters.
 */
export function slugify(title: string): string {
  let text = title.toLowerCase();
  for (const [pattern, replacement] of UMLAUTS) text = text.replace(pattern, replacement);
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks of decomposed accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Next free chapter prefix: max numeric prefix of the existing chapter ids
 * plus one, zero-padded to the widest existing prefix (at least two
 * digits). Chapters without a numeric prefix are ignored; no chapters at
 * all -> "01".
 */
export function nextChapterPrefix(chapterIds: readonly string[]): string {
  let max = 0;
  let width = 2;
  for (const id of chapterIds) {
    const match = /^(\d+)/.exec(id);
    if (match === null) continue;
    const digits = match[1] as string;
    max = Math.max(max, Number(digits));
    width = Math.max(width, digits.length);
  }
  return String(max + 1).padStart(width, "0");
}

/**
 * The directory name a new chapter would get: `<next prefix>-<slug>`.
 * Undefined while the title yields no slug — then there is nothing honest
 * to preview yet.
 */
export function newChapterId(title: string, chapterIds: readonly string[]): string | undefined {
  const slug = slugify(title);
  if (slug === "") return undefined;
  return `${nextChapterPrefix(chapterIds)}-${slug}`;
}

/**
 * Directories under a campaign that can never be a chapter — mirrors the
 * server's RESERVED_DIRS (server/src/generator.ts), which answers 404 for
 * them. Checking client-side only saves the round trip; the server stays the
 * last instance.
 */
const RESERVED_CHAPTER_IDS = new Set(["npcs", "locations", "sessions"]);

/**
 * Is this string usable as a chapter directory name? Returns the error text
 * for the field in the UI language, or undefined when the id is fine.
 *
 * The bar is the server's: a chapter id is ONE safe, non-hidden path segment
 * (assertSafeChapterId) and not a reserved directory. On top of that the
 * data format's ids are kebab (README: `01-salzhafen`), so uppercase,
 * umlauts and underscores are rejected here as well — deliberately as an
 * error, never as a silent rewrite: a manually typed id is the DM's
 * decision, and an id is a stable reference that must not change under them.
 * (A number prefix is optional — `schmugglerbucht` is as valid as
 * `03-schmugglerbucht`.)
 *
 * Order of the checks is by specificity: the most precise complaint wins,
 * the charset rule is the catch-all.
 */
export function chapterIdError(id: string, t: Translate): string | undefined {
  if (id === "") return t("generate.input.chapterId.missing");
  if (id.includes("/") || id.includes("\\")) return t("generate.input.chapterId.slash");
  if (id.includes("..")) return t("generate.input.chapterId.dots");
  if (id.startsWith(".")) return t("generate.input.chapterId.leadingDot");
  if (/\s/.test(id)) return t("generate.input.chapterId.space");
  if (!/^[a-z0-9-]+$/.test(id)) return t("generate.input.chapterId.charset");
  if (RESERVED_CHAPTER_IDS.has(id)) return t("generate.input.chapterId.reserved");
  return undefined;
}

/**
 * Is this string usable as an npc id? The npc generator's `id`
 * field is OPTIONAL — an empty field means "the model chooses" and is
 * therefore not an error. Everything else follows the same bar as a chapter
 * id (the server's kebab pattern) plus the one check only the client can do
 * cheaply: an id that already exists would be a 409, and saying so
 * before the run costs nothing.
 */
export function npcIdError(
  id: string,
  existingIds: readonly string[],
  t: Translate,
): string | undefined {
  if (id === "") return undefined;
  if (id.includes("/") || id.includes("\\")) return t("generate.input.npcId.slash");
  if (/\s/.test(id)) return t("generate.input.npcId.space");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return t("generate.input.npcId.charset");
  if (existingIds.includes(id)) return t("generate.input.npcId.exists");
  return undefined;
}

/**
 * What the chapter-id field shows: the manually entered
 * value once the DM has touched the field, the derived suggestion until
 * then. `manual === undefined` IS the untouched state — and because the view
 * maps an emptied field back to undefined, clearing the field lets the
 * suggestion follow the title again.
 */
export function chapterIdValue(
  suggestion: string | undefined,
  manual: string | undefined,
): string {
  return manual ?? suggestion ?? "";
}

/**
 * Summary inside the apply button: "2 Szenen · 1 Stub". One catalog entry per
 * sentence, so the plural of both halves is the message's business (ICU) and
 * nothing is glued together here.
 */
export function applySummary(sceneCount: number, stubCount: number, t: Translate): string {
  return t("generate.review.summary", { scenes: sceneCount, stubs: stubCount });
}

/**
 * The context hint under the source textarea: what the server will send along
 * with the prompt (generator/README.md step 1).
 *
 * Only the two COUNTS that come from the tree. The campaign knowledge and the
 * glossary used to be part of the same ICU sentence; since they are pages of
 * their own page they are LINKS, and a link
 * cannot live inside a formatted string without either splitting the pattern
 * or rendering markup out of the catalog. The view composes the line from this
 * half and the two below (routes/generate.tsx).
 */
export function contextHint(npcCount: number, locationCount: number, t: Translate): string {
  return t("generate.input.contextEntities", { npcs: npcCount, locations: locationCount });
}

/**
 * The knowledge half of that line: how many entries travel.
 *
 * The COUNT and not a yes/no like the glossary: the DM comes back here right
 * after writing a rule, and the number of knowledge entries is what confirms
 * it arrived.
 * Count with `promptKnowledgeCount` (lib/entry-list.ts) — a half-typed
 * convention is stored but skipped by the prompt.
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
  jobStatus?: GenerateJob["status"];
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
export function jobMode(job: GenerateJob | null | undefined): GenerateMode {
  return job?.kind === "npc" ? "npc" : "scene";
}

/**
 * Which mode the view shows after the server's job answered: a job that
 * EXISTS decides (its result belongs to its kind — restoring a run must land
 * in the right mode), no job leaves the DM's own choice alone. That
 * asymmetry is the point: applying or discarding an NPC run must not throw
 * the view back to scenes while the DM is still writing NPCs.
 */
export function restoredMode(current: GenerateMode, job: GenerateJob | null | undefined): GenerateMode {
  return job === null || job === undefined ? current : jobMode(job);
}

/**
 * The error body of a failed job — the same `{ error, validationErrors?,
 * rawReply?, usage? }` shape the synchronous endpoint used to answer with
 * (issues #18/#20), so the 422 block in the view is unchanged. Undefined for
 * every other status, and for a failed job without a body to show.
 */
export function jobErrorBody(
  job: GenerateJob | null | undefined,
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
// Everything the DM does in the review — the edited text, the decision per
// suggested entry, the dropped scenes, the per field/block decisions of an
// augment run — lives on the JOB, not in this browser. These are the pure
// halves of that: what the state IS, what a patch does to it, and what is
// still open. No fetching; the hook (lib/use-job-review.ts) does that.

/** A review state with nothing decided — also the fallback for an older payload. */
export function emptyReview(): GenerateJobReview {
  return { entries: {}, dropped: [], fields: {}, blocks: {}, written: {} };
}

/** The job's review state, degrading to "nothing decided" when it has none. */
export function reviewOf(job: GenerateJob | null | undefined): GenerateJobReview {
  const review = job?.review;
  if (review === undefined) return emptyReview();
  return {
    entries: review.entries ?? {},
    dropped: review.dropped ?? [],
    fields: review.fields ?? {},
    blocks: review.blocks ?? {},
    written: review.written ?? {},
  };
}

/** What one `PATCH …/review` changes — the same merge the server does. */
export interface ReviewPatch {
  edits?: Record<string, DraftEdit>;
  entries?: Record<string, GenerateReviewDecision | null>;
  dropped?: string[];
  fields?: Record<string, boolean | null>;
  blocks?: Record<string, boolean | null>;
}

/**
 * The job as it will look once a patch lands — the OPTIMISTIC copy the UI
 * shows while the request is in flight. It must merge exactly the way the
 * server does (generate-jobs.ts `applyReviewPatch`), including the one
 * asymmetry: `dropped` is a set sent whole, everything else merges per key,
 * and a `null` value — in `entries`, `fields` and `blocks` alike — means
 * that the decision is open again, which deletes the key.
 */
/**
 * What the review shows for one draft: the generated properties and body with
 * every edit laid on top, in order — the job's stored edit first, the buffer
 * the DM is typing in last. An edit half that is absent leaves the generated
 * one standing.
 */
export function draftOf(
  generated: { properties: Record<string, unknown>; body: string },
  ...edits: Array<DraftEdit | undefined>
): { properties: Record<string, unknown>; body: string } {
  let out = generated;
  for (const edit of edits) {
    if (edit === undefined) continue;
    out = {
      properties: edit.properties ?? out.properties,
      body: edit.body ?? out.body,
    };
  }
  return out;
}

/**
 * Merge draft edits PER PATH and per half: a properties edit must not drop a
 * body edit that is already on the job, and the other way round. Each half
 * that a patch carries replaces its counterpart whole (that is what a half
 * means, see DraftEdit); a half the patch leaves out keeps what is there.
 */
export function mergeDraftEdits(
  into: Record<string, DraftEdit>,
  patch?: Record<string, DraftEdit>,
): Record<string, DraftEdit> {
  const out = { ...into };
  for (const [path, edit] of Object.entries(patch ?? {})) {
    out[path] = { ...out[path], ...edit };
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

export function mergeReviewPatch(job: GenerateJob, patch: ReviewPatch): GenerateJob {
  const review = reviewOf(job);
  const entries = { ...review.entries };
  for (const [key, decision] of Object.entries(patch.entries ?? {})) {
    if (decision === null) delete entries[key];
    else entries[key] = decision;
  }
  return {
    ...job,
    draftEdits: mergeDraftEdits(job.draftEdits, patch.edits),
    review: {
      entries,
      dropped: patch.dropped === undefined ? review.dropped : [...new Set(patch.dropped)],
      fields: mergeFlags(review.fields, patch.fields),
      blocks: mergeFlags(review.blocks, patch.blocks),
      written: review.written,
    },
  };
}

/** What became of one part of a run. */
export type PartState = "open" | "written" | "dropped" | "rejected";

/**
 * The state of one part, addressed the way the review addresses it: a scene
 * by its draft path, a suggested entry by the address it would be written to
 * (`npcs/grella`). A WRITTEN part is read-only and links to the entry; a
 * dropped or rejected one is out of every accept.
 */
export function partState(job: GenerateJob | null | undefined, path: string): PartState {
  const review = reviewOf(job);
  if (review.written[path] !== undefined) return "written";
  if (review.dropped.includes(path)) return "dropped";
  if (review.entries[path] === "rejected") return "rejected";
  return "open";
}

/** Every part of a run, by the path the review addresses it with. */
export function jobParts(job: GenerateJob | null | undefined): string[] {
  const parts = (job?.result?.scenes ?? []).map((scene) => scene.path);
  for (const stub of job?.result?.stubs ?? []) parts.push(`${stub.kind}s/${stub.id}`);
  const npc = job?.npcResult?.npc.path;
  if (npc !== undefined) parts.push(npc);
  return parts;
}

/**
 * How far a partially accepted run got — the accepted count in the topbar
 * and on the generator page. `total` counts every part the run produced,
 * `written` the ones already accepted; a run nobody has accepted anything of
 * reports 0 and shows no progress at all.
 */
export function jobProgress(job: GenerateJob | null | undefined): {
  written: number;
  total: number;
} {
  const parts = jobParts(job);
  const review = reviewOf(job);
  return {
    written: parts.filter((path) => review.written[path] !== undefined).length,
    total: parts.length,
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
export function acceptProgress(job: GenerateJob | null | undefined): {
  written: number;
  total: number;
} {
  const progress = jobProgress(job);
  const parts = jobPipelineParts(job);
  if (parts.length === 0) return progress;
  return { written: progress.written, total: Math.max(parts.length, progress.total) };
}

/** The parts a bulk accept would write: everything still open. */
export function openParts(job: GenerateJob | null | undefined): string[] {
  return jobParts(job).filter((path) => partState(job, path) === "open");
}

// --- the pipeline of a scene run -------------------------------------------
//
// The run's parts are what the review is laid out by: a done part renders as
// the draft it produced, a running one as a status card, a failed one as its
// error plus its retry action. The OUTLINE is never here — the server does
// not send it, because it is an internal step and the DM never edits it.

/** The parts of a run, in outline order; empty for a single-call run. */
export function jobPipelineParts(job: GenerateJob | null | undefined): GenerateJobPart[] {
  return job?.pipeline?.parts ?? [];
}

/** Is there anything in this run the DM can already look at or act on? */
export function hasReviewableParts(job: GenerateJob | null | undefined): boolean {
  return jobPipelineParts(job).some((part) => part.status === "done" || part.status === "failed");
}

/** Is any part of the run still waiting or in flight? */
export function partsStillRunning(job: GenerateJob | null | undefined): boolean {
  return jobPipelineParts(job).some(
    (part) => part.status === "pending" || part.status === "running",
  );
}

/**
 * The part that produced a given draft path, or undefined. The review
 * addresses a scene as `<chapter>/<id>` and an entry as `npcs/<id>`; a part
 * knows its bare id and its kind, so the mapping is one place and not three.
 */
export function partForPath(
  job: GenerateJob | null | undefined,
  path: string,
): GenerateJobPart | undefined {
  const id = path.slice(path.lastIndexOf("/") + 1);
  const kind = path.startsWith("npcs/") ? "npc" : path.startsWith("locations/") ? "location" : "scene";
  return jobPipelineParts(job).find((part) => part.kind === kind && part.id === id);
}

/** The address the review uses for a part — the key an accept names. */
export function partPath(job: GenerateJob | null | undefined, part: GenerateJobPart): string {
  if (part.kind === "npc") return `npcs/${part.id}`;
  if (part.kind === "location") return `locations/${part.id}`;
  return `${job?.chapter ?? ""}/${part.id}`;
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
  job: GenerateJob | null | undefined,
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
  job: GenerateJob | null | undefined,
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
