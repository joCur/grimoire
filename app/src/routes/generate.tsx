// "/:campaign/generate" — the LLM generator (issue #12) per the design
// reference's GENERATOR section, four states in one route:
//
//   input   target chapter (existing chip or the "Neues Kapitel" flow with
//           a live path preview) + source text + the context hint
//   working the spinner while the SERVER's job runs (correction turns happen
//           inside that job, generator/README.md)
//   review  the drafts of a finished job: rendered through the SAME markdown
//           pipeline as a real scene, editable as raw markdown, stubs
//           accepted/rejected one by one. NOTHING is written yet.
//   done    the paths POST /generate/apply wrote — all as drafts
//
// Since issue #21 the route has TWO modes, picked by the quiet chip row above
// the input form: „Szenen" (scene drafts for a chapter) and „NPC" (one npc
// entry from source material). Both run through the same four states, the same
// background job (there is one generator job per campaign, whatever its kind)
// and the same apply endpoint — the NPC mode only asks for less (source text
// plus an optional id) and reviews exactly one card. The mode is not local
// trivia: a restored job decides it (job.kind), so a reload during an NPC run
// comes back in NPC mode.
//
// Since issue #19 the run is a background JOB on the server and this route
// is only its window: on mount it asks GET …/generate/job and restores
// whatever it finds (running -> working with ~3s polling, done -> review
// incl. the edits kept in the job, failed -> the error block). That is the
// whole point of the ticket: a browser-back gesture, a reload or a closed
// tab may not destroy minutes of generation any more.
//
// A failed run stays in the input state and shows the server's 422 in full
// (issue #18): the message — read in the UI language out of the job's error
// CODE (i18n/server-errors.ts; for a truncated reply the one naming the token
// cap) — the validation errors when there are any, the last raw reply behind a
// collapsed „Rohantwort anzeigen“, and the run's token spend.
//
// Local state is only what the server cannot know: the current edit buffers
// (mirrored into the job, debounced, so they survive too), which cards are
// in edit mode, the stub decisions, and the paths a finished apply wrote.
// Stub decisions are deliberately NOT persisted — re-deciding two rows is
// cheap, and nothing written is lost.

import type {
  CampaignTree,
  GenerateJob,
  GenerateJobPart,
  GenerateResult,
  GeneratedNpcDraft,
  GeneratedStub,
  NamingHint,
} from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Check,
  GitFork,
  MapPin,
  RotateCcw,
  Sparkles,
  SpellCheck,
  StickyNote,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  ApiError,
  acceptJobParts,
  deleteGenerateJob,
  fetchEntry,
  fetchKnowledge,
  fetchTree,
  retryJobPart,
  startGenerateJob,
  startGenerateNpcJob,
} from "@/api";
import {
  MarkdownEditorSurface,
  MarkdownEditorToggle,
} from "@/components/MarkdownEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { ReviewSaveStatus } from "@/components/ReviewSaveStatus";
import { Button } from "@/components/ui/button";
import { locationName } from "@/lib/campaign";
import { serverErrorBodyMessage, useT, type Translate } from "@/i18n";
import { npcStatusLabel } from "@/lib/entity";
import { fmQuickstats, fmString, fmStringArray } from "@/lib/properties";
import { sceneStatusMeta } from "@/lib/scene-status";
import {
  applySummary,
  chapterIdError,
  chapterIdValue,
  contextHint,
  knowledgeHint,
  generatePhase,
  runJobArrived,
  hasReviewableParts,
  jobErrorBody,
  jobMode,
  jobPipelineParts,
  jobProgress,
  markdownBody,
  newChapterId,
  npcIdError,
  openParts,
  partState,
  partsStillRunning,
  pipelineCostLabel,
  pipelineProgress,
  restoredMode,
  reviewOf,
  stringField,
  stringList,
  usageLabel,
  type GenerateMode,
  type PartState,
} from "@/lib/generate";
import { promptKnowledgeCount } from "@/lib/entry-list";
import { generateJobKey, useGenerateJob } from "@/lib/use-generate-job";
import { useJobReview } from "@/lib/use-job-review";
import { cn } from "@/lib/utils";

/** Which chapter the drafts are for: an existing one, or a new one. */
type Target = { kind: "chapter"; id: string } | { kind: "new" };

type StubDecision = "accepted" | "rejected";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";
/** The two links in „Mitgeschickter Kontext" — quiet, part of the sentence. */
const CONTEXT_LINK =
  "rounded px-0.5 text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const FIELD =
  "w-full rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-border-hover";
const CHIP = "rounded-full border px-3.5 py-[5px] text-[12.5px]";
const CHIP_ON =
  "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-hover";
const CHIP_OFF =
  "border-border bg-card text-body-secondary hover:border-border-hover hover:text-foreground";

/**
 * A suggested entry is addressed by the path it would be WRITTEN to
 * (`npcs/grella`) — that is the key the job's review state uses and the one
 * a partial accept selects with, so the UI must not invent a second one.
 */
const stubKey = (stub: GeneratedStub) => `${stub.kind}s/${stub.id}`;

export function GenerateRoute() {
  const t = useT();
  const { campaign = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  // Only for the context hint: the server sends glossary along with the
  // prompt when it exists (generator/README.md step 1). A missing entry is a
  // 404 and means "no glossary" — not an error worth retrying.
  const glossary = useQuery({
    queryKey: ["entry", campaign, "glossary"],
    queryFn: () => fetchEntry(campaign, "glossary"),
    enabled: campaign !== "",
    retry: false,
  });
  // Same purpose for the campaign knowledge (issue #53 AK5) — the hint names
  // the NUMBER of entries, so this reads the list, not an entry. The same
  // query key the settings editor writes, so a rule saved there shows up here
  // without a reload.
  const knowledge = useQuery({
    queryKey: ["knowledge", campaign],
    queryFn: () => fetchKnowledge(campaign),
    enabled: campaign !== "",
    retry: false,
  });

  const chapters = tree.data?.chapters ?? [];
  const chapterIds = chapters.map((c) => c.id);
  // Default target: the active chapter (fallback: the first) — the rule the
  // live nav and the review use as well.
  const defaultChapter = (chapters.find((c) => c.status === "active") ?? chapters[0])?.id;

  // Which run kind the form is for (issue #21). Local — until a job says
  // otherwise (see the seeding block below).
  const [mode, setMode] = useState<GenerateMode>("scene");

  const [picked, setPicked] = useState<Target>();
  const target: Target =
    picked ?? (defaultChapter === undefined ? { kind: "new" } : { kind: "chapter", id: defaultChapter });
  const [newTitle, setNewTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  // The chapter id of the "Neues Kapitel" flow (issue #22). undefined means
  // "the DM has not touched the field" — then the suggestion follows the
  // title. A manual edit pins the value; emptying the field maps back to
  // undefined, so a cleared field starts following the title again.
  const [manualId, setManualId] = useState<string>();

  const suggestedId = newChapterId(newTitle, chapterIds);
  const newIdInput = chapterIdValue(suggestedId, manualId);
  const newIdError = chapterIdError(newIdInput, t);
  // A typed id may name a chapter that is already there: then this is NOT a
  // new chapter — the drafts go into the existing directory and its
  // chapter entry stays untouched (#12 semantics), so neither the newChapter
  // flag nor a chapterTitle travels.
  const newIdExists = newIdError === undefined && chapterIds.includes(newIdInput);
  const creatingChapter = target.kind === "new" && !newIdExists;
  const chapterId =
    target.kind === "new" ? (newIdError === undefined ? newIdInput : undefined) : target.id;
  // A chapter that does not exist yet needs its display name — the server
  // rejects an empty chapterTitle on apply, so the run may not start without
  // one either. Only said once the id itself is usable: two complaints about
  // one half-filled form are noise.
  const titleMissing = creatingChapter && chapterId !== undefined && newTitle.trim() === "";
  // An empty field is the untouched state (no title yet, nothing typed) —
  // that is not a mistake to shout about, the generate button stays disabled
  // on its own.
  const showIdError = newIdError !== undefined && newIdInput !== "";

  // The NPC mode's own two fields (issue #21): its own source buffer, so
  // switching modes never eats what the DM pasted, and the optional id.
  const [npcSource, setNpcSource] = useState("");
  const [npcId, setNpcId] = useState("");
  const npcIds = (tree.data?.npcs ?? []).map((npc) => npc.id);
  const trimmedNpcId = npcId.trim();
  const npcIdMessage = npcIdError(trimmedNpcId, npcIds, t);

  // The TYPING overlay, nothing more: the saved text lives on the job
  // (`job.draftEdits`) and this only keeps the textarea from lagging behind
  // the keystroke while the debounced patch is on its way.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [written, setWritten] = useState<string[]>();

  // The server's job IS the state of a run (issue #19).
  //
  // `awaitingJob` is on from the click on „Entwürfe generieren" until the job
  // of THAT run is readable — it carries the id that was in the cache at the
  // click, because that is what the new job is not (lib/generate.ts
  // runJobArrived). It is the view's whole „working" state and the poll
  // loop's reason to live at the same time, and those two must be ONE flag:
  // a GET that overtakes the new row answers 404 and the previous run's job
  // is settled, so without it the interval was switched off and nothing
  // switched it back on — the spinner stood until a reload while the run
  // finished on the server.
  const [awaitingJob, setAwaitingJob] = useState<{
    staleJobId: string | null;
    startedJobId?: string;
  }>();
  const jobQuery = useGenerateJob(campaign, { expectJob: awaitingJob !== undefined });
  const job = jobQuery.data ?? null;
  const jobId = job?.id ?? null;
  // Every review change goes back to the job (issue #97): text debounced,
  // decisions immediately, both flushed before the view can go away.
  const review = useJobReview(campaign, job);
  const reviewState = reviewOf(job);
  const decisions = reviewState.entries;

  // Seed the local buffers from the job whenever the job IDENTITY changes —
  // a restored job brings its stored edits along, a new run starts clean.
  // Not on every poll: while typing, the local buffer is authoritative.
  // Tagged with the campaign, so switching campaigns is never mistaken for
  // "the job vanished" (same rule as useCampaignVersion).
  const [seeded, setSeeded] = useState<{ campaign: string; jobId: string | null }>();
  const [lostJob, setLostJob] = useState(false);
  // A job that disappears because WE applied or discarded it is not a loss.
  const droppedRef = useRef(false);
  if (jobQuery.isSuccess && (seeded?.campaign !== campaign || seeded.jobId !== jobId)) {
    const previous = seeded?.campaign === campaign ? seeded.jobId : undefined;
    setSeeded({ campaign, jobId });
    setEdits({});
    setEditing({});
    // A restored run decides the mode (issue #21) — its result belongs to its
    // kind. No job leaves the DM's choice alone.
    setMode((current) => restoredMode(current, job));
    if (previous === undefined) setWritten(undefined);
    // Gone without us applying or discarding it: the server was restarted.
    setLostJob(jobId === null && previous !== undefined && previous !== null && !droppedRef.current);
    if (jobId === null) droppedRef.current = false;
  }

  // Which result field to read is the job's kind, never the local mode: a
  // done job of the other kind must not be rendered as this one's.
  const jobKind = jobMode(job);
  // A pipelined run (issue #102) has a result WHILE it runs: every finished
  // part is already in it, so the review fills up instead of appearing whole.
  const result =
    (job?.status === "done" || (job?.status === "running" && hasReviewableParts(job))) &&
    jobKind === "scene"
      ? job.result
      : undefined;
  const npcResult = job?.status === "done" && jobKind === "npc" ? job.npcResult : undefined;
  const scenes = result?.scenes ?? [];
  const stubs = result?.stubs ?? [];
  const acceptedStubs = stubs.filter((s) => decisions[stubKey(s)] === "accepted");
  /** The text of one draft: what is being typed, else the job's, else the model's. */
  const draftText = (path: string, fallback: string): string =>
    edits[path] ?? job?.draftEdits[path] ?? fallback;
  /** What is still reviewable — „Alle übernehmen" and „Verwerfen" work on it. */
  const rest = openParts(job);
  const progress = jobProgress(job);
  const openScenes = scenes.filter((scene) => partState(job, scene.path) === "open");
  const openAcceptedStubs = acceptedStubs.filter((s) => partState(job, stubKey(s)) === "open");

  const start = useMutation({
    mutationFn: () =>
      mode === "npc"
        ? startGenerateNpcJob(campaign, { sourceText: npcSource, id: trimmedNpcId })
        : startGenerateJob(campaign, {
            chapter: chapterId as string,
            sourceText,
            newChapter: creatingChapter,
            // The title travels with the START now — the accept
            // must not depend on this tab still being open.
            ...(creatingChapter ? { chapterTitle: newTitle.trim() } : {}),
          }),
    // 202 (or an adopted 409 — the api client hands back the running job's
    // id): from here on the job query drives the view.
    onMutate: () => {
      // From here on this run's job is EXPECTED — see `awaitingJob` above.
      // The id in the cache right now is the one it will NOT have.
      setAwaitingJob({ staleJobId: jobId });
    },
    onSuccess: (started) => {
      // The id the start answered with belongs to THIS wait — kept here and
      // not read off `start.data`, which outlives it: a second run over a
      // failed one would otherwise recognise the OLD run's job as its own.
      setAwaitingJob((waiting) =>
        waiting === undefined ? waiting : { ...waiting, startedJobId: started.jobId },
      );
      setLostJob(false);
      setWritten(undefined);
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
    onError: () => {
      // The run never started: stop waiting for a job that is not coming.
      setAwaitingJob(undefined);
    },
  });

  /**
   * „Übernehmen" (issue #97). ONE endpoint for both buttons and both modes:
   * without a selection it writes everything that is still open (the
   * accepted suggested entries included, an undecided one not — the rule
   * from before this ticket); with one it writes exactly that part and
   * leaves the rest reviewable. The server answers which job is gone,
   * which is what ends the review.
   */
  const apply = useMutation({
    mutationFn: async (paths?: string[]) => {
      // Text the DM is still typing must be part of what gets written — and
      // AWAITED, not merely started: the server reads `draftEdits` when the
      // accept arrives, so a patch still in flight would land after the read
      // and be deleted together with the job (issue #97 review, finding 1).
      await review.flush();
      // The flush moved the rev; the guard has to carry the one that is
      // current now, not the one this render closed over.
      const current = queryClient.getQueryData<GenerateJob | null>(generateJobKey(campaign));
      return acceptJobParts(campaign, job?.id ?? "", current?.rev ?? job?.rev ?? 0, {
        ...(paths === undefined ? {} : { paths }),
        // The new chapter's entry is created in the same batch — but the
        // JOB decides it, and this pair is only the compatibility
        // override. It therefore travels ONLY when the form on screen is
        // still the form that STARTED this run: the review is
        // persistent, so the DM can pick another chapter in the form while a
        // finished job waits — and sending that other id here used to create
        // a stray chapter the run has nothing to do with. When the two
        // disagree, the job is right and nothing is sent.
        ...(creatingChapter && chapterId !== undefined && job?.chapter === chapterId
          ? { chapter: chapterId, chapterTitle: newTitle.trim() }
          : {}),
      });
    },
    onError: (error) => {
      // The accept carries the review rev (issue #97 review, finding 3): a
      // 409 `rev_conflict` means another tab decided in between and NOTHING
      // was written, so the job is re-read and the quiet conflict line says
      // so — the same protocol the review patch follows.
      if (error instanceof ApiError && error.status === 409 && error.details.code === "rev_conflict") {
        review.signalConflict();
        return;
      }
      // Any OTHER 409 says the run moved on: a part that is not open any
      // more, a run that has produced nothing yet (issue #102 AK2 allows an
      // accept while it is still running, so „nichts fertig" is now a real
      // answer). Nothing was written — re-read and say so in one line.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      }
    },
    onSuccess: (data) => {
      const addresses = Object.values(data.written);
      // ONLY the answer decides: a bulk accept whose rest did not settle the
      // run leaves the job there, and marking it dropped up front turned a
      // job that is still open into one that „vanished" (issue #97 review,
      // finding 7).
      if (data.jobDeleted) {
        droppedRef.current = true;
        setWritten((prev) => [...(prev ?? []), ...addresses]);
      }
      // The entries exist now — the pool has to show them.
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
  });

  // „Verwerfen": drops the server's job and with it the OPEN REST only —
  // parts a partial accept already wrote are entries now, not a job
  // (issue #97, Lead-Entscheid).
  const discard = useMutation({
    mutationFn: () => deleteGenerateJob(campaign),
    onMutate: () => {
      droppedRef.current = true;
    },
    onSettled: () => {
      apply.reset();
      start.reset();
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
  });

  /**
   * The card that currently REPRESENTS each pipeline part, keyed by the
   * part's key — the status card while the part is open, the draft card once
   * it is done. Both register here, because a part changes which component
   * it is rendered by while the focus is supposed to stay on it.
   */
  const partCards = useRef(new Map<string, HTMLElement | null>());
  /**
   * The part „Erneut versuchen" handed the focus to, until the focus is
   * actually sitting on its card.
   *
   * Focusing once in `onSuccess` was not enough (issue #102 review): the
   * button unmounts the moment the part goes `running`, and the status card
   * itself unmounts the moment the part is `done` and becomes its draft card
   * — with a fast model both happen within a poll of the click, so the focus
   * fell to `body` and a keyboard DM landed at the top of the page
   * (quality floor: focus stays visible and where the work is). So the focus
   * FOLLOWS the part across those swaps, once per commit, and stops as soon
   * as the part is settled or the DM has moved the focus themselves.
   */
  const focusPart = useRef<string | undefined>(undefined);

  /** „Erneut versuchen" for one failed part (issue #102). */
  const retry = useMutation({
    mutationFn: (key: string) => retryJobPart(campaign, job?.id ?? "", key),
    onSuccess: (updated, key) => {
      // The answer IS the job, with the part back in `running` — seeding the
      // cache with it means the next poll continues from the truth instead of
      // from a stale "failed".
      queryClient.setQueryData(generateJobKey(campaign), updated);
      focusPart.current = key;
    },
    onError: (error) => {
      // A 409 here is not „der Server ist kaputt": the part is already
      // running or already finished, which a second tab or a double click
      // produces. Whatever the state is, it is newer than this view's.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
  });
  /**
   * What a part's own card shows below its error — per part, because ONE
   * `isError` rendered in a global spot said „nicht neu gestartet" next to
   * every card and never cleared. `retry.variables` is the key of the last
   * mutate, and react-query resets `isError` on the next one.
   */
  const retryError = (key: string): string | undefined => {
    if (!retry.isError || retry.variables !== key) return undefined;
    const status = retry.error instanceof ApiError ? retry.error.status : undefined;
    return t(
      status === 409 ? "generate.pipeline.retryConflict" : "generate.pipeline.retryFailed",
    );
  };
  /** The part this retry is currently spending a call on — and only that one. */
  const retryBusy = (key: string): boolean => retry.isPending && retry.variables === key;

  const parts = jobPipelineParts(job);
  const sceneParts = parts.filter((part) => part.kind === "scene");
  const entryParts = parts.filter((part) => part.kind !== "scene");
  const running = partsStillRunning(job);
  /**
   * Hand the focus to the card that NOW represents the retried part — after
   * the commit, so it is handed to the card that is actually on the screen.
   * No dependency list on purpose: the question is asked once per commit,
   * which is exactly when the card behind a part can have been swapped.
   */
  useEffect(() => {
    const key = focusPart.current;
    if (key === undefined) return;
    const card = partCards.current.get(key) ?? undefined;
    const active = document.activeElement;
    // The DM moved the focus themselves (clicked elsewhere, tabbed on) —
    // never yank it back out of their hands.
    const ours = active === null || active === document.body || card?.contains(active) === true;
    if (!ours) {
      focusPart.current = undefined;
      return;
    }
    if (card === undefined) return;
    if (active !== card) card.focus();
    // Settled: this card is the last one the part will have, so stop
    // following it — the next poll must not re-take the focus.
    const part = parts.find((candidate) => candidate.key === key);
    if (part === undefined || part.status === "done" || part.status === "failed") {
      focusPart.current = undefined;
    }
  });
  const runProgress = pipelineProgress(job, t);
  const runCost = pipelineCostLabel(job, t);
  /** The draft of a finished scene part, by the address the review uses. */
  const sceneOfPart = (part: GenerateJobPart) =>
    scenes.find((scene) => scene.path === `${job?.chapter ?? ""}/${part.id}`);
  const stubOfPart = (part: GenerateJobPart) =>
    stubs.find((stub) => stub.kind === part.kind && stub.id === part.id);
  /** Stubs in the result that no entry PART accounts for (see the list below). */
  const unclaimedStubs = stubs.filter(
    (stub) => !entryParts.some((part) => part.kind === stub.kind && part.id === stub.id),
  );

  const applied = written !== undefined;
  // The window between the click and „this run's job is readable" is the
  // working state — and NOTHING else is: the moment the job
  // answers, the job decides, even while its own 202 is still on the way.
  // A fast run is finished before that response arrives, and making the
  // request's lifetime the spinner's left the DM in front of a done run.
  const arrived =
    awaitingJob !== undefined &&
    runJobArrived({
      jobId,
      staleJobId: awaitingJob.staleJobId,
      ...(awaitingJob.startedJobId === undefined
        ? {}
        : { startedJobId: awaitingJob.startedJobId }),
    });
  if (arrived) setAwaitingJob(undefined);
  const starting = awaitingJob !== undefined && !arrived && !applied;
  const phase = generatePhase({
    applied,
    starting,
    jobChecked: jobQuery.isSuccess || jobQuery.isError,
    ...(job === null ? {} : { jobStatus: job.status }),
    hasParts: hasReviewableParts(job),
  });

  const startError = start.error instanceof ApiError ? start.error : undefined;
  // A failed job carries the same body the endpoint used to answer with:
  // the last raw reply and (when the endpoint reports usage) what the run
  // cost — a truncated reply additionally carries an error CODE instead of a
  // validation error list (issue #18), and serverErrorBodyMessage turns that
  // code into this language's sentence (issue #69).
  // Shown only in ITS OWN mode: after switching to the other mode the block
  // would talk about a run this form cannot repeat.
  const failed = jobKind === mode ? jobErrorBody(job) : undefined;
  const validationErrors = stringList(failed?.validationErrors);
  const rawReply = stringField(failed?.rawReply);
  const failedUsage = usageLabel(failed?.usage, t);
  const failedMessage = serverErrorBodyMessage(failed, t);
  const resultUsage = usageLabel(result?.usage ?? npcResult?.usage, t);
  const conflicts = apply.error instanceof ApiError && apply.error.status === 409
    ? stringList(apply.error.details.conflicts)
    : [];

  const canGenerate =
    campaign !== "" &&
    !starting &&
    (mode === "npc"
      ? npcSource.trim() !== "" && npcIdMessage === undefined
      : chapterId !== undefined && !titleMissing && sourceText.trim() !== "");

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[680px] px-5 pt-8 pb-24 md:px-7 md:pt-10 md:pb-[100px]">
        {phase === "input" && (
          <>
            <h1 className="mb-2 font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
              {t(mode === "npc" ? "generate.input.title.npc" : "generate.input.title.scene")}
            </h1>
            <p className="mb-5 text-[14px] leading-[1.6] text-body-secondary">
              {t(mode === "npc" ? "generate.input.lead.npc" : "generate.input.lead.scene")}
            </p>

            {/* The mode switch (issue #21): two quiet chips, same vocabulary
                as the chapter chips below. Switching drops a stale error of
                the other mode's last attempt, nothing else — both modes keep
                their own source buffer. */}
            <div
              role="group"
              aria-label={t("generate.input.modeGroup")}
              className="mb-[26px] flex flex-wrap gap-2"
            >
              {(["scene", "npc"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => {
                    setMode(option);
                    start.reset();
                    apply.reset();
                  }}
                  className={cn(CHIP, mode === option ? CHIP_ON : CHIP_OFF)}
                >
                  {t(option === "npc" ? "generate.input.mode.npc" : "generate.input.mode.scene")}
                </button>
              ))}
            </div>

            {mode === "npc" && (
              <>
                <label htmlFor="gen-npc-source" className={cn(OVERLINE, "mb-2 block")}>
                  {t("generate.input.npc.sourceLabel")}
                </label>
                <textarea
                  id="gen-npc-source"
                  rows={12}
                  value={npcSource}
                  onChange={(e) => setNpcSource(e.target.value)}
                  placeholder={t("generate.input.npc.sourcePlaceholder")}
                  className={cn(FIELD, "resize-y leading-[1.6] text-body")}
                />

                <label
                  htmlFor="gen-npc-id"
                  className="mt-3.5 mb-1.5 block text-[12px] text-muted-foreground"
                >
                  {t("generate.input.npc.idLabel")}
                </label>
                <input
                  id="gen-npc-id"
                  type="text"
                  value={npcId}
                  onChange={(e) => setNpcId(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-invalid={npcIdMessage !== undefined}
                  aria-describedby="gen-npc-id-note"
                  placeholder={t("generate.input.npc.idPlaceholder")}
                  className={cn(
                    FIELD,
                    "max-w-[320px] py-2.5 font-mono text-[12.5px]",
                    npcIdMessage !== undefined && "border-destructive focus-visible:border-destructive",
                  )}
                />
                <p
                  id="gen-npc-id-note"
                  aria-live="polite"
                  className={cn(
                    "mt-[7px] text-[11.5px] leading-[1.5]",
                    npcIdMessage !== undefined
                      ? "text-destructive"
                      : trimmedNpcId === ""
                        ? "text-muted-foreground"
                        : "font-mono text-faint",
                  )}
                >
                  {npcIdMessage ??
                    (trimmedNpcId === ""
                      ? t("generate.input.npc.idHint")
                      : t("generate.input.npc.idPreview", { id: trimmedNpcId }))}
                </p>
              </>
            )}

            {mode === "scene" && (
              <>
                <div className={cn(OVERLINE, "mb-2")} id="gen-target-label">
                  {t("generate.input.targetLabel")}
                </div>
                <div role="group" aria-labelledby="gen-target-label" className="mb-[22px] flex flex-wrap gap-2">
                  {chapters.map((chapter) => {
                    const on = target.kind === "chapter" && target.id === chapter.id;
                    return (
                      <button
                        key={chapter.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked({ kind: "chapter", id: chapter.id })}
                        className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                      >
                        {chapter.title}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={target.kind === "new"}
                    onClick={() => setPicked({ kind: "new" })}
                    className={cn(CHIP, target.kind === "new" ? CHIP_ON : CHIP_OFF)}
                  >
                    {t("generate.input.newChapter")}
                  </button>
                </div>

                {/* The "Neues Kapitel" flow: display name + the directory name.
                    The id used to be a read-only preview; since issue #22 it is
                    the field that decides where the drafts land — the DM owns
                    it, because renaming a chapter later is expensive (ids are
                    stable references). The title is only the display name and
                    is meaningless for an id that already exists. */}
                {target.kind === "new" && (
                  <div className="mt-[-10px] mb-[22px] flex flex-col gap-[7px]">
                    <label htmlFor="gen-new-title" className="sr-only">
                      {t("generate.input.newTitleLabel")}
                    </label>
                    <input
                      id="gen-new-title"
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      disabled={newIdExists}
                      placeholder={t("generate.input.newTitlePlaceholder")}
                      className={cn(
                        FIELD,
                        "max-w-[320px] py-2.5",
                        newIdExists && "opacity-50 cursor-not-allowed",
                      )}
                    />
                    {titleMissing && (
                      <p className="text-[12px] leading-[1.5] text-muted-foreground">
                        {t("generate.input.titleMissing")}
                      </p>
                    )}

                    <label htmlFor="gen-new-id" className="mt-2 text-[12px] text-muted-foreground">
                      {t("generate.input.chapterIdLabel")}
                    </label>
                    <input
                      id="gen-new-id"
                      type="text"
                      value={newIdInput}
                      // Emptying the field is not a value — it hands the field
                      // back to the title (issue #22 AK4).
                      onChange={(e) =>
                        setManualId(e.target.value === "" ? undefined : e.target.value)
                      }
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      aria-invalid={showIdError}
                      aria-describedby="gen-new-id-note"
                      placeholder={t("generate.input.chapterIdPlaceholder")}
                      className={cn(
                        FIELD,
                        "max-w-[320px] py-2.5 font-mono text-[12.5px]",
                        showIdError && "border-destructive focus-visible:border-destructive",
                      )}
                    />
                    <p
                      id="gen-new-id-note"
                      aria-live="polite"
                      className={cn(
                        "text-[11.5px] leading-[1.5]",
                        showIdError
                          ? "text-destructive"
                          : newIdExists || newIdInput === ""
                            ? "text-muted-foreground"
                            : "font-mono text-faint",
                      )}
                    >
                      {showIdError
                        ? newIdError
                        : newIdExists
                          ? t("generate.input.chapterExists")
                          : newIdInput === ""
                            ? t("generate.input.chapterIdSuggested")
                            : t("generate.input.chapterIdPreview", { id: newIdInput })}
                    </p>
                  </div>
                )}

                <label htmlFor="gen-source" className={cn(OVERLINE, "mb-2 block")}>
                  {t("generate.input.sourceLabel")}
                </label>
                <textarea
                  id="gen-source"
                  rows={12}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={t("generate.input.sourcePlaceholder")}
                  className={cn(FIELD, "resize-y leading-[1.6] text-body")}
                />
              </>
            )}

            {/* Both modes send the same context along (npc/location names,
                the campaign knowledge and the glossary, generator/README.md
                step 1). The last two are LINKS since they became pages of
                their own (issue #53, PO feedback on PR #87): this line is
                exactly where the DM notices a rule is missing, and it should
                be one click from here to the page that fixes it. */}
            <p className="mt-2.5 mb-[26px] flex flex-wrap items-baseline gap-1.5 text-[12px] leading-[1.5] text-faint">
              <span>{t("generate.input.contextLabel")}</span>
              <span className="text-muted-foreground">
                {contextHint(tree.data?.npcs.length ?? 0, tree.data?.locations.length ?? 0, t)}
              </span>
              <span aria-hidden>·</span>
              <Link to={`/${campaign}/knowledge`} className={CONTEXT_LINK}>
                {knowledgeHint(promptKnowledgeCount(knowledge.data?.entries ?? []), t)}
              </Link>
              <span aria-hidden>·</span>
              <Link to={`/${campaign}/glossary`} className={CONTEXT_LINK}>
                {t(glossary.isSuccess ? "generate.input.glossary" : "generate.input.noGlossary")}
              </Link>
            </p>

            <Button
              type="button"
              disabled={!canGenerate}
              onClick={() => {
                apply.reset();
                start.mutate();
              }}
              className="h-auto gap-2 px-[18px] py-2.5 text-[13.5px] font-semibold [&_svg]:size-[15px]"
            >
              <Sparkles aria-hidden />
              {t(mode === "npc" ? "generate.input.submit.npc" : "generate.input.submit.scene")}
            </Button>

            {tree.isError && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                {t(mode === "npc" ? "generate.error.treeNpc" : "generate.error.treeScene")}
              </p>
            )}

            {/* A job that vanished (applied elsewhere, discarded in another
                tab) — said once, quietly, instead of a spinner that never
                ends. Since issue #23 a restart is NOT one of the reasons any
                more: the job comes back, a running one as `failed` with its
                own message. The hint keeps the restart as a parenthetical
                guess because that is still the likeliest cause for a DM. */}
            {lostJob && (
              <p aria-live="polite" className="mt-4 text-[13px] text-muted-foreground">
                {t("generate.error.lostJob")}
              </p>
            )}

            {startError?.status === 503 && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                {t("generate.error.noApiKey")}
              </p>
            )}

            {/* The 422 block: the message first, then WHY (validation
                errors), then WHAT came back (the raw reply, collapsed), then
                what the run cost. A truncated reply has no error list — its
                message is the server's, and it names LLM_MAX_TOKENS. */}
            {failed !== undefined && (
              <div
                aria-live="polite"
                className="mt-4 rounded-md border border-input bg-card px-3.5 py-3"
              >
                <p className="mb-1.5 text-[13.5px] leading-[1.5] font-medium text-foreground">
                  {validationErrors.length > 0
                    ? t("generate.error.validation")
                    : (failedMessage ?? t("generate.error.unusable"))}
                </p>
                {validationErrors.length > 0 && (
                  <>
                    <ul className="flex flex-col gap-1">
                      {validationErrors.map((error) => (
                        <li
                          key={error}
                          className="font-mono text-[11.5px] leading-[1.5] text-body-secondary"
                        >
                          {error}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {t("generate.error.validationHint")}
                    </p>
                  </>
                )}
                {rawReply !== undefined && (
                  <details className="mt-2.5">
                    <summary className="cursor-pointer text-[12.5px] text-body-secondary hover:text-foreground">
                      {t("generate.error.rawReply")}
                    </summary>
                    <pre className="mt-2 max-h-[260px] overflow-auto rounded-md border border-input bg-background px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-body-secondary">
                      {rawReply}
                    </pre>
                  </details>
                )}
                {failedUsage !== undefined && (
                  <p className="mt-2.5 text-[12px] text-faint">{failedUsage}</p>
                )}
              </div>
            )}

            {/* Everything else (incl. a plain network failure, where there is
                no ApiError at all) stays one honest line. A 409 here can only
                be the NPC id collision (a 409 carrying a jobId is adopted by
                the api client, not thrown). */}
            {start.isError && startError?.status !== 503 && (
              <p aria-live="polite" className="mt-4 text-[13px] text-destructive">
                {startError?.status === 409
                  ? t("generate.error.npcExists")
                  : startError?.status === 404
                    ? t("generate.error.chapterMissing")
                    : t("generate.error.failed")}
              </p>
            )}
          </>
        )}

        {/* The first job lookup: one request, and until it answers neither
            the form nor a spinner would be honest — a running job would
            flash the empty form. */}
        {phase === "checking" && <div className="py-24 md:py-[120px]" />}

        {phase === "working" && <Working />}

        {/* The review of a SCENE run — gated on the phase and the job's kind,
            never on a result being there (issue #102 review): in a pipelined
            run the parts are the review's spine and the drafts only fill it
            in, so a run whose sole reviewable part FAILED has something to
            show (its error and its „Erneut versuchen") while `result` is
            still empty. Gating on the result rendered that state as an empty
            page, and the run only became visible on a reload. */}
        {phase === "review" && jobKind === "scene" && (
          <>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
              <h1 className="font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
                {t("generate.review.title")}
              </h1>
              {/* THE live region of the review (quality floor): the run's
                  progress is announced here and nowhere else. Every part card
                  used to be one of its own, so a run with three parts read
                  out three times per poll. */}
              <span aria-live="polite" className="text-[13px] text-muted-foreground">
                {/* While the RUN is still going its own progress is the more
                    useful number — „2 von 3 Szenen fertig" (issue #102);
                    once it is finished, the review's is (issue #97). */}
                {runProgress ??
                  (progress.written === 0
                    ? t("generate.review.pending", {
                        summary: applySummary(scenes.length, stubs.length, t),
                      })
                    : t("generate.review.progress", progress))}
              </span>
              <ReviewSaveStatus status={review.status} />
            </div>
            <p
              className={cn(
                "text-[14px] leading-[1.6] text-body-secondary",
                (runCost ?? resultUsage) === undefined ? "mb-[22px]" : "mb-1.5",
              )}
            >
              {t("generate.review.lead")}
            </p>
            {/* What the run cost — quiet, but never invisible (issue #18).
                A pipelined run reports its own totals, summed over every part
                and every correction turn, and counts CALLS rather than
                attempts (issue #102 AK5). */}
            {(runCost ?? resultUsage) !== undefined && (
              <p className="mb-[22px] text-[12px] text-faint">{runCost ?? resultUsage}</p>
            )}
            {/* The run is not done — say so once, and say that what is here
                can already be accepted. */}
            {/* Not a live region: the sentence never changes while it is
                there, so announcing it belongs to the progress line above. */}
            {running && (
              <p className="mb-[18px] text-[13px] leading-[1.6] text-body-secondary">
                {t("generate.pipeline.stillRunning")}
              </p>
            )}

            {(result?.warnings ?? []).map((warning) => (
              <div
                key={warning}
                className="mb-2 flex items-start gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3.5 py-2.5"
              >
                <StickyNote aria-hidden size={15} className="mt-px flex-none text-primary" />
                <p className="text-[13px] leading-[1.55] text-soft">{warning}</p>
              </div>
            ))}

            <NamingHints hints={result?.namingHints} t={t} />

            {/* The parts in OUTLINE order (issue #102): a finished one is its
                draft, an open one a status card, a failed one its error plus
                „Erneut versuchen". A run without parts — an older job — falls
                back to the plain draft list below. */}
            {sceneParts.map((part) => {
              const scene = part.status === "done" ? sceneOfPart(part) : undefined;
              if (scene === undefined) {
                return (
                  <PartCard
                    key={part.key}
                    part={part}
                    // A part that says `done` and has no draft in the result
                    // is a broken run, not a waiting one — it used to render
                    // as „wartet" forever, with nothing the DM could do.
                    mismatch={part.status === "done"}
                    busy={retryBusy(part.key)}
                    error={retryError(part.key)}
                    cardRef={(el) => partCards.current.set(part.key, el)}
                    onRetry={() => retry.mutate(part.key)}
                  />
                );
              }
              return (
                <SceneCard
                  key={scene.path}
                  cardRef={(el) => partCards.current.set(part.key, el)}
                  campaign={campaign}
                  path={scene.path}
                  properties={scene.properties}
                  markdown={draftText(scene.path, scene.markdown)}
                  tree={tree.data}
                  state={partState(job, scene.path)}
                  writtenAt={reviewState.written[scene.path]}
                  busy={apply.isPending}
                  editing={editing[scene.path] === true}
                  onToggleEditing={() =>
                    setEditing((prev) => ({ ...prev, [scene.path]: prev[scene.path] !== true }))
                  }
                  onChange={(markdown) => {
                    setEdits((prev) => ({ ...prev, [scene.path]: markdown }));
                    review.edit(scene.path, markdown);
                  }}
                  onBlur={review.flush}
                  onAccept={() => apply.mutate([scene.path])}
                  onDrop={() =>
                    review.decide({
                      dropped: reviewState.dropped.includes(scene.path)
                        ? reviewState.dropped.filter((path) => path !== scene.path)
                        : [...reviewState.dropped, scene.path],
                    })
                  }
                />
              );
            })}

            {sceneParts.length === 0 &&
              scenes.map((scene) => (
              <SceneCard
                key={scene.path}
                campaign={campaign}
                path={scene.path}
                properties={scene.properties}
                markdown={draftText(scene.path, scene.markdown)}
                tree={tree.data}
                state={partState(job, scene.path)}
                writtenAt={reviewState.written[scene.path]}
                busy={apply.isPending}
                editing={editing[scene.path] === true}
                onToggleEditing={() =>
                  setEditing((prev) => ({ ...prev, [scene.path]: prev[scene.path] !== true }))
                }
                onChange={(markdown) => {
                  // Local first (the textarea must not lag), then debounced
                  // into the JOB — that copy is what survives a navigation.
                  setEdits((prev) => ({ ...prev, [scene.path]: markdown }));
                  review.edit(scene.path, markdown);
                }}
                // Leaving the field is the last cheap moment to be sure.
                onBlur={review.flush}
                onAccept={() => apply.mutate([scene.path])}
                onDrop={() =>
                  review.decide({
                    dropped: reviewState.dropped.includes(scene.path)
                      ? reviewState.dropped.filter((path) => path !== scene.path)
                      : [...reviewState.dropped, scene.path],
                  })
                }
              />
            ))}

            {(stubs.length > 0 || entryParts.length > 0) && (
              <>
                <div className={cn(OVERLINE, "mb-2.5")}>{t("generate.review.stubsHeading")}</div>
                {entryParts.map((part) => {
                  const stub = part.status === "done" ? stubOfPart(part) : undefined;
                  if (stub === undefined) {
                    return (
                      <PartCard
                        key={part.key}
                        part={part}
                        mismatch={part.status === "done"}
                        busy={retryBusy(part.key)}
                        error={retryError(part.key)}
                        cardRef={(el) => partCards.current.set(part.key, el)}
                        onRetry={() => retry.mutate(part.key)}
                      />
                    );
                  }
                  return (
                    <StubRow
                      key={stubKey(stub)}
                      cardRef={(el) => partCards.current.set(part.key, el)}
                      campaign={campaign}
                      stub={stub}
                      reason={stubReason(scenes, t)}
                      decision={decisions[stubKey(stub)]}
                      state={partState(job, stubKey(stub))}
                      writtenAt={reviewState.written[stubKey(stub)]}
                      busy={apply.isPending}
                      onDecide={(decision) =>
                        review.decide({ entries: { [stubKey(stub)]: decision ?? null } })
                      }
                      onAccept={() => apply.mutate([stubKey(stub)])}
                    />
                  );
                })}
                {/* Stubs no entry part claims: a run whose outline proposed
                    nothing but whose SCENE replies carried stubs (the pre-#102
                    shape, and any older job), and a stub whose part id drifted.
                    They used to be invisible as soon as the run had any entry
                    part at all — proposed, generated, and never shown. */}
                {unclaimedStubs.map((stub) => (
                  <StubRow
                    key={stubKey(stub)}
                    campaign={campaign}
                    stub={stub}
                    reason={stubReason(scenes, t)}
                    decision={decisions[stubKey(stub)]}
                    state={partState(job, stubKey(stub))}
                    writtenAt={reviewState.written[stubKey(stub)]}
                    busy={apply.isPending}
                    onDecide={(decision) =>
                      review.decide({ entries: { [stubKey(stub)]: decision ?? null } })
                    }
                    onAccept={() => apply.mutate([stubKey(stub)])}
                  />
                ))}
              </>
            )}

            {conflicts.length > 0 && (
              <div aria-live="polite" className="mb-3 rounded-md border border-input bg-card px-3.5 py-3">
                <p className="mb-1.5 text-[13px] text-foreground">
                  {t("generate.review.conflicts")}
                </p>
                <ul className="flex flex-col gap-1">
                  {conflicts.map((path) => (
                    <li key={path} className="font-mono text-[11.5px] text-body-secondary">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {apply.isError && conflicts.length === 0 && (
              <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
                {t(
                  apply.error instanceof ApiError && apply.error.status === 409
                    ? "generate.review.applyStale"
                    : "generate.review.applyFailed",
                )}
              </p>
            )}
            {discard.isError && (
              <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
                {t("generate.review.discardFailed")}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-[18px]">
              {/* „Alle übernehmen" writes what is LEFT — the count follows
                  the partial accepts instead of promising the whole run
                  again (issue #97). */}
              <Button
                type="button"
                disabled={apply.isPending || openScenes.length + openAcceptedStubs.length === 0}
                onClick={() => apply.mutate(undefined)}
                className="h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
              >
                {t(progress.written === 0 ? "generate.review.apply" : "generate.review.applyRest", {
                  count: applySummary(openScenes.length, openAcceptedStubs.length, t),
                })}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={apply.isPending || discard.isPending}
                onClick={() => discard.mutate()}
                className="h-auto border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t(progress.written === 0 ? "common.discard" : "generate.review.discardRest")}
              </Button>
              {rest.length === 0 && progress.written > 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  {t("generate.review.allDecided")}
                </p>
              )}
            </div>
          </>
        )}

        {/* The NPC review (issue #21): one card, the same warnings/usage/cost
            lines and the same two actions — there is nothing to decide per
            item, so no stub rows and no count in the apply button. */}
        {phase === "review" && npcResult !== undefined && (
          <>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
              <h1 className="font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
                {t("generate.review.titleNpc")}
              </h1>
              <span className="text-[13px] text-muted-foreground">
                {t("generate.review.pendingNpc")}
              </span>
              <ReviewSaveStatus status={review.status} />
            </div>
            <p
              className={cn(
                "text-[14px] leading-[1.6] text-body-secondary",
                resultUsage === undefined ? "mb-[22px]" : "mb-1.5",
              )}
            >
              {t("generate.review.leadNpc")}
            </p>
            {resultUsage !== undefined && (
              <p className="mb-[22px] text-[12px] text-faint">{resultUsage}</p>
            )}

            {npcResult.warnings.map((warning) => (
              <div
                key={warning}
                className="mb-2 flex items-start gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3.5 py-2.5"
              >
                <StickyNote aria-hidden size={15} className="mt-px flex-none text-primary" />
                <p className="text-[13px] leading-[1.55] text-soft">{warning}</p>
              </div>
            ))}

            <NamingHints hints={npcResult.namingHints} t={t} />

            <NpcDraftCard
              draft={npcResult.npc}
              markdown={draftText(npcResult.npc.path, npcResult.npc.markdown)}
              editing={editing[npcResult.npc.path] === true}
              onToggleEditing={() =>
                setEditing((prev) => ({
                  ...prev,
                  [npcResult.npc.path]: prev[npcResult.npc.path] !== true,
                }))
              }
              onChange={(markdown) => {
                setEdits((prev) => ({ ...prev, [npcResult.npc.path]: markdown }));
                review.edit(npcResult.npc.path, markdown);
              }}
              onBlur={review.flush}
            />

            {conflicts.length > 0 && (
              <div aria-live="polite" className="mb-3 rounded-md border border-input bg-card px-3.5 py-3">
                <p className="mb-1.5 text-[13px] text-foreground">
                  {t("generate.review.conflictsNpc")}
                </p>
                <ul className="flex flex-col gap-1">
                  {conflicts.map((path) => (
                    <li key={path} className="font-mono text-[11.5px] text-body-secondary">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {apply.isError && conflicts.length === 0 && (
              <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
                {t(
                  apply.error instanceof ApiError && apply.error.status === 409
                    ? "generate.review.applyStale"
                    : "generate.review.applyFailed",
                )}
              </p>
            )}
            {discard.isError && (
              <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
                {t("generate.review.discardFailed")}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-[18px]">
              <Button
                type="button"
                disabled={apply.isPending}
                onClick={() => apply.mutate(undefined)}
                className="h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
              >
                {t("generate.review.applyNpc")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={apply.isPending || discard.isPending}
                onClick={() => discard.mutate()}
                className="h-auto border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t("common.discard")}
              </Button>
            </div>
          </>
        )}

        {phase === "done" && written !== undefined && (
          <div className="flex flex-col items-start gap-3.5 py-14 md:py-20">
            <p className="flex items-center gap-2.5 text-[15px] text-foreground">
              <Check aria-hidden size={17} className="flex-none text-success-text" />
              {t(mode === "npc" ? "generate.written.title.npc" : "generate.written.title.scene")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {written.map((path) => (
                <li key={path} className="font-mono text-[12.5px] text-body-secondary">
                  {path}
                </li>
              ))}
            </ul>
            <p className="max-w-[420px] text-[13px] leading-[1.6] text-muted-foreground">
              {t(mode === "npc" ? "generate.written.hint.npc" : "generate.written.hint.scene")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2.5">
              {mode === "npc" && written[0] !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
                    void navigate(`/${campaign}/entry/${written[0]}`);
                  }}
                  className="h-auto border-input bg-transparent px-4 py-2.5 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  {t("generate.written.openNpc")}
                </Button>
              )}
              <Button
                type="button"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
                  void navigate(`/${campaign}`);
                }}
                className="h-auto px-4 py-2.5 text-[13px] font-semibold"
              >
                {t("generate.written.toPool")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The API has no reason field per stub — the honest reason is the batch the
 * stub came out of, so the row names the scene(s) of this run.
 */
function stubReason(scenes: GenerateResult["scenes"], t: Translate): string {
  const first = scenes[0];
  if (first === undefined) return t("generate.stub.reason.run");
  const title = fmString(first.properties.title) ?? first.path;
  return t(scenes.length === 1 ? "generate.stub.reason.scene" : "generate.stub.reason.scenes", {
    title,
  });
}

/**
 * The naming check's findings (issue #53 AK3) — the ONE block on this page
 * that is not the model's voice but the server's.
 *
 * It is deliberately QUIETER than the warnings above it: a hairline box, no
 * accent border, one small heading that says „kein Blocker" out loud. The
 * check is a plain text search (server/src/naming-check.ts) and can be wrong
 * about whether a hit is the thing the rule meant, so it may not look like a
 * verdict — and it must never compete with the draft the DM is reading.
 *
 * Nothing renders when there is nothing to say: an empty „0 Hinweise" box
 * would be noise on every single run of every campaign without conventions.
 */
function NamingHints({ hints, t }: { hints: NamingHint[] | undefined; t: Translate }) {
  if (hints === undefined || hints.length === 0) return null;
  return (
    <section className="mb-[22px] rounded-md border border-border bg-card px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
        <SpellCheck aria-hidden size={14} className="flex-none" />
        <h2 className="font-medium">
          {t("generate.review.namingHeading", { count: hints.length })}
        </h2>
      </div>
      <ul className="flex flex-col gap-2">
        {hints.map((hint, index) => (
          // The key needs every coordinate: one rule can hit the same path
          // twice (a property and a body line), and two rules can hit the
          // same line. The index closes the remaining tie.
          <li key={`${hint.path}:${hint.field}:${hint.line ?? 0}:${hint.from}:${index}`}>
            <p className="text-[13px] leading-[1.5] text-soft">
              {t("generate.review.namingHint", { from: hint.from, to: hint.to })}
            </p>
            <p className="mt-0.5 font-mono text-[11.5px] text-faint">
              {hint.line === undefined
                ? t("generate.review.namingWhereField", {
                    path: hint.path,
                    field: hint.field,
                  })
                : t("generate.review.namingWhereBody", { path: hint.path, line: hint.line })}
            </p>
            {/* The line itself, so the DM can judge the hit without opening
                the draft — the check's whole claim is „it says this here". */}
            <p className="mt-0.5 text-[12px] leading-[1.5] text-muted-foreground">
              {hint.excerpt}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The working state: spinner + the correction-turn explainer + the one fact
 * that matters since issue #19 — the run is on the server, so the tab may
 * go. No number of attempts here: LLM_CORRECTION_TURNS is a server setting
 * (default 1) and a hardcoded "max. 2" would be a lie in half the setups.
 */
function Working() {
  const t = useT();
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-[18px] py-24 text-center md:py-[120px]"
    >
      {/* Motion is optional: the ring animates only when motion is welcome,
          otherwise a static brass ring stands in for it. */}
      <span
        aria-hidden
        className="size-[30px] animate-spin rounded-full border-[3px] border-input border-t-primary motion-reduce:hidden"
      />
      <span
        aria-hidden
        className="hidden size-[30px] rounded-full border-[3px] border-primary motion-reduce:block"
      />
      <p className="text-[14.5px] text-foreground">{t("generate.working.title")}</p>
      <p className="max-w-[380px] text-[13px] leading-[1.6] text-muted-foreground">
        {t("generate.working.correction")}
      </p>
      <p className="max-w-[380px] text-[12.5px] leading-[1.6] text-faint">
        {t("generate.working.background")}
      </p>
    </div>
  );
}

/**
 * One part of a pipelined run that has no draft to show yet (issue #102):
 * waiting, being written, or failed.
 *
 * It is deliberately the SAME footprint as a draft card, in the same place in
 * the list — the review is laid out in outline order, and a part that moves
 * from „wird geschrieben" to a finished scene must not make everything below
 * it jump. Quieter than a draft: a hairline card, the title the outline gave
 * the part, and one line saying what is going on.
 *
 * A failed part is the only one with a button. WHY it failed is said in this
 * language (the raw server sentence „generation failed mechanical validation
 * after retries" is English and is the DM's only headline otherwise), with
 * the mechanical error list unchanged below it and the raw reply behind the
 * same disclosure the whole-run failure uses — the DM decides from it whether
 * to retry or to drop the run.
 *
 * `mismatch` is the third failure there is: a part the server calls `done`
 * whose draft is not in the result. It used to render as „wartet" with no
 * action at all, forever.
 */
function PartCard({
  part,
  busy,
  error,
  mismatch = false,
  cardRef,
  onRetry,
}: {
  part: GenerateJobPart;
  busy: boolean;
  /** This part's own retry error, already translated (never a global one). */
  error?: string;
  mismatch?: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const failed = part.status === "failed" || mismatch;
  const validationErrors = part.validationErrors ?? [];
  return (
    <section
      ref={cardRef}
      // Focusable only programmatically: „Erneut versuchen" unmounts its own
      // button, so the retry hands the focus to the card instead of letting
      // it fall to `body` (issue #102 review). Not a live region — the review
      // has exactly one, on its progress line.
      tabIndex={-1}
      className={cn(
        "mb-3 rounded-lg border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        failed ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[16px] leading-[1.3] font-semibold text-foreground">
          {part.title}
        </h2>
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {part.status === "running" && (
            <>
              {/* Motion is optional — a static ring stands in for it. */}
              <span
                aria-hidden
                className="size-[13px] flex-none animate-spin rounded-full border-2 border-input border-t-primary motion-reduce:hidden"
              />
              <span
                aria-hidden
                className="hidden size-[13px] flex-none rounded-full border-2 border-primary motion-reduce:block"
              />
            </>
          )}
          {t(
            failed
              ? "generate.pipeline.partFailed"
              : part.status === "running"
                ? "generate.pipeline.partRunning"
                : "generate.pipeline.partPending",
          )}
        </span>
      </div>
      {failed && (
        <>
          {/* The headline: this language's sentence when the failure IS the
              form check (its server message is English), the server's own
              text otherwise — a restart, a provider outage and a 500 all say
              something the DM needs verbatim. */}
          {mismatch ? (
            <p className="mt-2 text-[13px] leading-[1.55] text-body-secondary">
              {t("generate.pipeline.partMissing")}
            </p>
          ) : validationErrors.length > 0 ? (
            <p className="mt-2 text-[13px] leading-[1.55] text-body-secondary">
              {t("generate.pipeline.partInvalid")}
            </p>
          ) : (
            part.error !== undefined && (
              <p className="mt-2 text-[13px] leading-[1.55] text-body-secondary">{part.error}</p>
            )
          )}
          {validationErrors.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {validationErrors.map((message) => (
                <li
                  key={message}
                  className="font-mono text-[11.5px] leading-[1.5] text-body-secondary"
                >
                  {message}
                </li>
              ))}
            </ul>
          )}
          {/* WHAT came back — the same disclosure the whole-run failure uses
              (issue #18). The part carries its own last raw reply. */}
          {part.rawReply !== undefined && part.rawReply !== "" && (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[12.5px] text-body-secondary hover:text-foreground">
                {t("generate.error.rawReply")}
              </summary>
              <pre className="mt-2 max-h-[260px] overflow-auto rounded-md border border-input bg-background px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-body-secondary">
                {part.rawReply}
              </pre>
            </details>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onRetry}
            className="mt-3 h-auto gap-2 border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground [&_svg]:size-[14px]"
          >
            <RotateCcw aria-hidden />
            {t("generate.pipeline.retry")}
          </Button>
          {/* The retry's own failure, next to the button that caused it. */}
          {error !== undefined && (
            <p className="mt-2 text-[13px] text-destructive">{error}</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * One draft as a card: title/pill/edit toggle, mono target path, the chip row
 * from the properties, then either the rendered body (same markdown pipeline
 * as a real scene) or the raw markdown in a mono textarea. Title and chips
 * come from the properties the SERVER parsed — raw edits show up in the
 * preview and on apply, not in the card's header.
 */
function SceneCard({
  campaign,
  path,
  properties,
  markdown,
  tree,
  state,
  writtenAt,
  busy,
  editing,
  cardRef,
  onToggleEditing,
  onChange,
  onBlur,
  onAccept,
  onDrop,
}: {
  campaign: string;
  path: string;
  properties: Record<string, unknown>;
  markdown: string;
  tree: CampaignTree | undefined;
  /** What became of this scene (issue #97) — written parts are read-only. */
  state: PartState;
  /** The address it landed at, once it is written. */
  writtenAt: string | undefined;
  busy: boolean;
  editing: boolean;
  /**
   * Registers this card as what represents its pipeline part right now — the
   * retry's focus follows the part across the swap from status card to draft
   * card (issue #102 review).
   */
  cardRef?: (el: HTMLElement | null) => void;
  onToggleEditing: () => void;
  onChange: (markdown: string) => void;
  onBlur: () => void;
  onAccept: () => void;
  onDrop: () => void;
}) {
  const t = useT();
  const title = fmString(properties.title) ?? path;
  const status = fmString(properties.status) ?? "draft";
  // Show the status LABEL, never the raw frontmatter value (#88); unknown
  // values still degrade to their verbatim text inside the helper.
  const statusLabel = sceneStatusMeta(status, t).label;
  const isContingency = fmString(properties.type) === "contingency";
  const location = locationName(tree, fmString(properties.location));
  const tags = fmStringArray(properties.tags);
  const textareaId = `gen-raw-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const written = state === "written";

  return (
    <div
      ref={cardRef}
      // Focusable only programmatically, like the status card it replaces.
      tabIndex={-1}
      className={cn(
        "my-4 rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--card)_60%,var(--background))] px-5 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:px-6",
        state === "dropped" && "opacity-55",
      )}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <h2 className="flex-1 font-serif text-[20px] leading-[1.3] font-semibold text-foreground">
          {title}
        </h2>
        <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
          {statusLabel}
        </span>
        {/* A written part is not editable here any more (issue #97, Nicht-
            Ziele): it is an entry now, and the normal editor owns it. */}
        {!written && (
          <MarkdownEditorToggle
            editing={editing}
            onToggleEditing={onToggleEditing}
            controlsId={textareaId}
          />
        )}
      </div>
      <p className="mb-3.5 font-mono text-[11.5px] text-faint">{path}</p>
      <div className="mb-2 flex flex-wrap gap-2 border-b border-border pb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-soft">
          {isContingency ? (
            <GitFork aria-hidden size={13} className="flex-none text-muted-foreground" />
          ) : (
            <Bookmark aria-hidden size={13} className="flex-none text-muted-foreground" />
          )}
          {t(isContingency ? "generate.review.contingency" : "generate.review.plannedScene")}
        </span>
        {location !== undefined && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-body-secondary">
            <MapPin aria-hidden size={13} className="flex-none text-muted-foreground" />
            {location}
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-muted-foreground"
          >
            {/* The hashtag is the data format's marker, not copy. */}
            {`#${tag}`}
          </span>
        ))}
      </div>
      <MarkdownEditorSurface
        editing={editing && !written}
        id={textareaId}
        value={markdown}
        onChange={onChange}
        onBlur={onBlur}
        label={t("generate.review.rawLabel", { title })}
        // A draft is a whole entry — the preview renders the body only.
        preview={markdownBody(markdown)}
      />
      <PartActions
        campaign={campaign}
        state={state}
        writtenAt={writtenAt}
        busy={busy}
        onAccept={onAccept}
        onDrop={onDrop}
      />
    </div>
  );
}

/**
 * What can be done with ONE part of a run (issue #97): write it on its own,
 * drop it, or — once it is written — open the entry it became.
 *
 * The row is deliberately the same under a scene card and under a suggested
 * entry: „Diesen übernehmen" means the same thing in both places, and a
 * written part reads the same way in both.
 */
function PartActions({
  campaign,
  state,
  writtenAt,
  busy,
  onAccept,
  onDrop,
}: {
  campaign: string;
  state: PartState;
  writtenAt: string | undefined;
  busy: boolean;
  onAccept: () => void;
  onDrop?: () => void;
}) {
  const t = useT();
  if (state === "written") {
    return (
      <p className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
        <Check aria-hidden size={14} className="flex-none text-success-text" />
        {t("generate.review.partWritten")}
        {writtenAt !== undefined && (
          <Link
            to={`/${campaign}/entry/${writtenAt}`}
            className="rounded font-mono text-[11.5px] underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {writtenAt}
          </Link>
        )}
      </p>
    );
  }
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <Button
        type="button"
        variant="outline"
        disabled={busy || state === "dropped"}
        onClick={onAccept}
        className="h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover"
      >
        {t("generate.review.acceptOne")}
      </Button>
      {onDrop !== undefined && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onDrop}
          className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
        >
          {t(state === "dropped" ? "generate.review.undrop" : "generate.review.drop")}
        </Button>
      )}
    </div>
  );
}

/**
 * The generated NPC entry as a card (issue #21): the generator's own card
 * chrome (title, status pill, edit toggle, mono target path) with the NPC
 * facts of the reading view above the body — role, voice, appearance,
 * quickstats chips, statblock reference, in the same vocabulary and with the
 * same helpers as EntityArticle's NPC header (issue #26). The presentation is
 * rebuilt here rather than reused wholesale on purpose: EntityArticle takes a
 * EntryResponse of an entry that EXISTS, and nothing is written yet.
 *
 * Same two views as a scene draft: the rendered body through the normal
 * markdown pipeline, or the raw markdown in a mono textarea.
 */
function NpcDraftCard({
  draft,
  markdown,
  editing,
  onToggleEditing,
  onChange,
  onBlur,
}: {
  draft: GeneratedNpcDraft;
  markdown: string;
  editing: boolean;
  onToggleEditing: () => void;
  onChange: (markdown: string) => void;
  onBlur: () => void;
}) {
  const t = useT();
  const fm = draft.properties;
  const name = fmString(fm.name) ?? draft.path;
  const status = fmString(fm.status);
  const role = fmString(fm.role);
  const voice = fmString(fm.voice);
  const appearance = fmString(fm.appearance);
  const statblock = fmString(fm.statblock);
  const quickstats = fmQuickstats(fm.quickstats);
  const textareaId = `gen-raw-${draft.path.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  return (
    <div className="my-4 rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--card)_60%,var(--background))] px-5 py-5 md:px-6">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <h2 className="flex-1 font-serif text-[20px] leading-[1.3] font-semibold text-foreground">
          {name}
        </h2>
        {status !== undefined && (
          <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
            {npcStatusLabel(status, t)}
          </span>
        )}
        <MarkdownEditorToggle
          editing={editing}
          onToggleEditing={onToggleEditing}
          controlsId={textareaId}
        />
      </div>
      <p className="mb-3.5 font-mono text-[11.5px] text-faint">{draft.path}</p>
      <div className="mb-2 border-b border-border pb-4">
        {role !== undefined && (
          <p className="text-[13.5px] leading-[1.5] text-muted-foreground">{role}</p>
        )}
        {voice !== undefined && (
          <p className="mt-2 text-[14px] leading-[1.6] text-body italic">{voice}</p>
        )}
        {appearance !== undefined && (
          <p className="mt-1 text-[14px] leading-[1.6] text-body-secondary italic">{appearance}</p>
        )}
        {quickstats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quickstats.map(([key, value]) => (
              <span
                key={key}
                className="rounded-[4px] border border-input bg-background px-[7px] py-[3px] font-mono text-[11px] text-soft"
              >
                {key} {value}
              </span>
            ))}
          </div>
        )}
        {statblock !== undefined && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            {t("generate.review.statblock", { statblock })}
          </p>
        )}
      </div>
      <MarkdownEditorSurface
        editing={editing}
        id={textareaId}
        value={markdown}
        onChange={onChange}
        onBlur={onBlur}
        label={t("generate.review.rawLabel", { title: name })}
        // A draft is a whole entry — the preview renders the body only.
        preview={markdownBody(markdown)}
      />
    </div>
  );
}

/** One stub row: marker, name, mono target path, italic reason, decision. */
function StubRow({
  campaign,
  stub,
  reason,
  decision,
  state,
  writtenAt,
  busy,
  cardRef,
  onDecide,
  onAccept,
}: {
  campaign: string;
  stub: GeneratedStub;
  reason: string;
  decision: StubDecision | undefined;
  state: PartState;
  writtenAt: string | undefined;
  busy: boolean;
  /** Same as SceneCard's: the retry's focus follows the part here too. */
  cardRef?: (el: HTMLElement | null) => void;
  onDecide: (decision: StubDecision | undefined) => void;
  onAccept: () => void;
}) {
  const t = useT();
  const path = `${stub.kind}s/${stub.id}`;
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className={cn(
        "mb-[18px] flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        (decision === "rejected" || state === "rejected") && "opacity-55",
      )}
    >
      {stub.kind === "npc" ? (
        <User aria-hidden size={16} className="flex-none text-muted-foreground" />
      ) : (
        <MapPin aria-hidden size={16} className="flex-none text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] text-foreground">{stub.name}</span>
          <span className="font-mono text-[11px] text-faint">{path}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground italic">{reason}</p>
      </div>
      {state === "written" ? (
        <p className="flex flex-none items-center gap-2 text-[12.5px] text-muted-foreground">
          <Check aria-hidden size={14} className="flex-none text-success-text" />
          {t("generate.review.partWritten")}
          {writtenAt !== undefined && (
            <Link
              to={`/${campaign}/entry/${writtenAt}`}
              className="rounded font-mono text-[11px] underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {writtenAt}
            </Link>
          )}
        </p>
      ) : decision === undefined ? (
        <div className="flex flex-none gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide("accepted")}
            className="h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover"
          >
            {t("generate.stub.accept")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide("rejected")}
            className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            {t("generate.stub.reject")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-none items-center gap-2">
          {/* An ACCEPTED entry can be written on its own (issue #97) — the
              rest of the run stays reviewable. */}
          {decision === "accepted" && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onAccept}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("generate.review.acceptOne")}
            </Button>
          )}
          {/* The decided row stays a control so a wrong decision is
              reversible (the prototype shows a label; a click puts the
              buttons back). */}
          <button
            type="button"
            onClick={() => onDecide(undefined)}
            title={t("generate.stub.undo")}
            className={cn(
              "flex-none rounded-md px-1.5 py-1 text-[12.5px]",
              decision === "accepted" ? "text-primary-hover" : "text-muted-foreground",
            )}
          >
            {t(decision === "accepted" ? "generate.stub.accepted" : "generate.stub.rejected")}
          </button>
        </div>
      )}
    </div>
  );
}
