// "/campaigns/:campaign/generate" — the LLM generator per the design
// reference's GENERATOR section, four states in one route:
//
//   input   target chapter (existing chip or the new-chapter flow with
//           a live id preview) + source text + the context hint
//   working the spinner while the SERVER's job runs (correction turns happen
//           inside that job, generator/README.md)
//   review  the proposed scenes of a finished job: rendered through the SAME
//           markdown pipeline as a real scene, editable in the fields and on
//           the surfaces the scene itself is edited with (the scene's slice,
//           scene/SceneProposalCard.tsx), proposed npcs and locations
//           accepted/rejected one by one. NOTHING is written yet.
//   done    what the accept wrote — the scenes as drafts
//
// The route has TWO modes, picked by the quiet chip row above
// the input form: scenes (scene drafts for a chapter) and npc (one npc from
// source material). Both run through the same four states, the same
// background job (there is one generator job per campaign, whatever its kind)
// and the same accept endpoint — the NPC mode only asks for less (source text
// plus an optional id) and reviews exactly one card; its form and its review
// live in the npc's slice (npc/NpcRun.tsx), and this route only picks the
// mode. The mode is not local trivia: a restored job decides it (job.kind),
// so a reload during an NPC run comes back in NPC mode.
//
// The run is a background JOB on the server and this route
// is only its window: on mount it asks GET …/generate/job and restores
// whatever it finds (running -> working with ~3s polling, done -> review
// incl. the edits kept in the job, failed -> the error block). So a
// browser-back gesture, a reload or a closed tab does not destroy minutes of
// generation.
//
// A failed run stays in the input state and shows the server's 422 in full:
// the message — read in the UI language out of the job's error
// CODE (i18n/server-errors.ts; for a truncated reply the one naming the token
// cap) — the validation errors when there are any, the last raw reply behind a
// collapsed raw-reply disclosure, and the run's token spend.
//
// Local state is only what the server cannot know: the current edit buffers
// (mirrored into the job, debounced, so they survive too), which cards are
// in edit mode, and what a finished accept wrote. The decisions live on the
// job (review.npcs, review.locations).

import type {
  GenerateJob,
  GenerateJobPart,
  GenerateResult,
  LocationProposal,
  NamingHint,
  NpcProposal,
  SceneChange,
  SceneProposal,
} from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, Sparkles, SpellCheck, StickyNote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  ApiError,
  acceptJobParts,
  deleteGenerateJob,
  fetchGlossary,
  fetchKnowledge,
  fetchTree,
  retryJobPart,
  startGenerateJob,
} from "@/api";
import { chapterLabel } from "@/chapter/chapter-links";
import { chapterIdError, chapterIdValue, newChapterId } from "@/chapter/chapter-run";
import { MobileBackRow } from "@/components/MobileBackRow";
import { ReviewSaveStatus } from "@/components/ReviewSaveStatus";
import { Button } from "@/components/ui/button";
import { serverErrorBodyMessage, serverErrorMessage, useT, type Translate } from "@/i18n";
import {
  applySummary,
  contextHint,
  knowledgeHint,
  generatePhase,
  runJobArrived,
  hasReviewableParts,
  jobErrorBody,
  jobMode,
  jobPipelineParts,
  jobProgress,
  locationState,
  npcState,
  openLocations,
  openNpcs,
  openScenes,
  partsStillRunning,
  pipelineCostLabel,
  pipelineProgress,
  restoredMode,
  reviewOf,
  sceneState,
  stringField,
  stringList,
  usageLabel,
  type GenerateMode,
} from "@/lib/generate";
import { promptKnowledgeCount } from "@/lib/entry-list";
import { generateJobKey, useGenerateJob } from "@/lib/use-generate-job";
import { useJobReview } from "@/lib/use-job-review";
import { cn } from "@/lib/utils";
import { LocationProposalRow } from "@/location/LocationProposalRow";
import { locationLabel } from "@/location/location-links";
import { locationsKey } from "@/location/location-query";
import { Markdown } from "@/markdown/Markdown";
import { NpcProposalRow } from "@/npc/NpcProposalRow";
import { NpcRunFields, NpcRunReview, NpcRunWrittenAction, useNpcRunForm } from "@/npc/NpcRun";
import { npcLabel } from "@/npc/npc-links";
import { npcsKey } from "@/npc/npc-query";
import { SceneProposalCard } from "@/scene/SceneProposalCard";
import { sceneLabel } from "@/scene/scene-links";
import { sceneOf } from "@/scene/scene-proposal";

/** Which chapter the drafts are for: an existing one, or a new one. */
type Target = { kind: "chapter"; id: string } | { kind: "new" };

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";
/** The two links in the sent-context hint — quiet, part of the sentence. */
const CONTEXT_LINK =
  "rounded px-0.5 text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const FIELD =
  "w-full rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-border-hover";
const CHIP = "rounded-full border px-3.5 py-[5px] text-[12.5px]";
const CHIP_ON =
  "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-hover";
const CHIP_OFF =
  "border-border bg-card text-body-secondary hover:border-border-hover hover:text-foreground";

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
  // Only for the context hint: the server sends the glossary along with the
  // prompt when there is one (generator/README.md step 1). An empty list means
  // "no glossary" — not an error worth retrying.
  const glossary = useQuery({
    queryKey: ["glossary", campaign],
    queryFn: () => fetchGlossary(campaign),
    enabled: campaign !== "",
    retry: false,
  });
  // Same purpose for the campaign knowledge — the hint names
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

  // Which run kind the form is for. Local — until a job says
  // otherwise (see the seeding block below).
  const [mode, setMode] = useState<GenerateMode>("scene");

  const [picked, setPicked] = useState<Target>();
  const target: Target =
    picked ?? (defaultChapter === undefined ? { kind: "new" } : { kind: "chapter", id: defaultChapter });
  const [newTitle, setNewTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  // The chapter id of the new-chapter flow. undefined means
  // "the DM has not touched the field" — then the suggestion follows the
  // title. A manual edit pins the value; emptying the field maps back to
  // undefined, so a cleared field starts following the title again.
  const [manualId, setManualId] = useState<string>();

  const suggestedId = newChapterId(newTitle, chapterIds);
  const newIdInput = chapterIdValue(suggestedId, manualId);
  const newIdError = chapterIdError(newIdInput, t);
  // A typed id may name a chapter that is already there: then this is NOT a
  // new chapter — the drafts go into that chapter, which stays untouched, so
  // neither the newChapter flag nor a chapterTitle travels.
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

  // The NPC mode's form — its own buffers, in the npc's slice.
  const npcRun = useNpcRunForm(tree.data);

  // The TYPING overlay, nothing more: the saved changes live on the job
  // (`job.sceneEdits`) and this only keeps the fields from lagging behind the
  // keystroke while the debounced patch is on its way.
  const [edits, setEdits] = useState<Record<string, SceneChange>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [written, setWritten] = useState<string[]>();
  // The npc an NPC run's accept wrote — what the open action opens once the job
  // is gone.
  const [writtenNpc, setWrittenNpc] = useState<string>();

  // The server's job IS the state of a run.
  //
  // `awaitingJob` is on from the click on the generate action until the job
  // of THAT run is readable — it carries the id that was in the cache at the
  // click, because that is what the new job is not (lib/generate.ts
  // runJobArrived). It is the view's whole working state and the poll
  // loop's reason to live at the same time, and those two must be ONE flag:
  // a GET that overtakes the new row answers 404 and the previous run's job
  // is settled, so without the flag the interval would switch off with
  // nothing to switch it back on — and the spinner would stand until a
  // reload while the run finished on the server.
  const [awaitingJob, setAwaitingJob] = useState<{
    staleJobId: string | null;
    startedJobId?: string;
  }>();
  const jobQuery = useGenerateJob(campaign, { expectJob: awaitingJob !== undefined });
  const job = jobQuery.data ?? null;
  const jobId = job?.id ?? null;
  // Every review change goes back to the job: text debounced,
  // decisions immediately, both flushed before the view can go away.
  const review = useJobReview(campaign, job);
  const reviewState = reviewOf(job);

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
    // A restored run decides the mode — its result belongs to its
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
  // A pipelined run has a result WHILE it runs: every finished
  // part is already in it, so the review fills up instead of appearing whole.
  const result =
    (job?.status === "done" || (job?.status === "running" && hasReviewableParts(job))) &&
    jobKind === "scene"
      ? job.result
      : undefined;
  const npcResult = job?.status === "done" && jobKind === "npc" ? job.npcResult : undefined;
  const scenes = result?.scenes ?? [];
  // The proposed npcs and locations are their own lists (ADR #31), decided
  // and accepted by id.
  const proposedNpcs = result?.npcs ?? [];
  const acceptedNpcs = proposedNpcs.filter((npc) => reviewState.npcs[npc.id] === "accepted");
  const proposedLocations = result?.locations ?? [];
  const acceptedLocations = proposedLocations.filter(
    (location) => reviewState.locations[location.id] === "accepted",
  );
  /**
   * One proposed scene as the review shows it: what the run produced, with
   * the job's stored change and then the local buffer laid over it.
   */
  const sceneFor = (proposed: SceneProposal) =>
    sceneOf(proposed, job?.sceneEdits[proposed.id], edits[proposed.id]);
  /** A proposed scene changed: local first, then debounced into the job. */
  const editScene = (id: string, change: SceneChange): void => {
    setEdits((previous) => ({ ...previous, [id]: { ...previous[id], ...change } }));
    review.editScene(id, change);
  };
  /** What is still reviewable — the accept-all and discard actions work on it. */
  const rest = openScenes(job);
  const progress = jobProgress(job);
  const openProposedScenes = scenes.filter((scene) => sceneState(job, scene.id) === "open");
  const openAcceptedNpcs = acceptedNpcs.filter((npc) => npcState(job, npc.id) === "open");
  const openAcceptedLocations = acceptedLocations.filter(
    (location) => locationState(job, location.id) === "open",
  );
  const restNpcs = openNpcs(job);
  const restLocations = openLocations(job);

  const start = useMutation({
    mutationFn: () =>
      mode === "npc"
        ? npcRun.start(campaign)
        : startGenerateJob(campaign, {
            chapter: chapterId as string,
            sourceText,
            newChapter: creatingChapter,
            // The title travels with the START — the accept must not depend
            // on this tab still being open.
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
   * Accepting. ONE endpoint for both buttons and both modes:
   * without a selection it writes everything that is still open (the
   * accepted npcs and locations included, an undecided one not); with one
   * selection it writes exactly that part and
   * leaves the rest reviewable. The server answers which job is gone,
   * which is what ends the review.
   */
  const apply = useMutation({
    mutationFn: async (selection?: { scenes?: string[]; npcs?: string[]; locations?: string[] }) => {
      // Text the DM is still typing must be part of what gets written — and
      // AWAITED, not merely started: the server reads `sceneEdits` and
      // `npcEdits` when the accept arrives, so a patch still in flight would
      // land after the read and be deleted together with the job.
      await review.flush();
      // The flush moved the rev; the guard has to carry the one that is
      // current now, not the one this render closed over.
      const current = queryClient.getQueryData<GenerateJob | null>(generateJobKey(campaign));
      return acceptJobParts(campaign, job?.id ?? "", current?.rev ?? job?.rev ?? 0, {
        ...(selection?.scenes === undefined ? {} : { scenes: selection.scenes }),
        ...(selection?.npcs === undefined ? {} : { npcs: selection.npcs }),
        ...(selection?.locations === undefined ? {} : { locations: selection.locations }),
        // The new chapter is created in the same batch — but the JOB
        // decides it, and this pair is only the compatibility override. It
        // therefore travels ONLY when the form on screen is still the form
        // that STARTED this run: the review state is persistent, so the DM
        // can pick another chapter in the form while a finished run waits —
        // and sending that other id here would create a chapter the run has
        // nothing to do with. When the two disagree, the job is right and
        // nothing is sent.
        ...(creatingChapter && chapterId !== undefined && job?.chapter === chapterId
          ? { chapter: chapterId, chapterTitle: newTitle.trim() }
          : {}),
      });
    },
    onError: (error) => {
      // The accept carries the review rev: a
      // 409 `rev_conflict` means another tab decided in between and NOTHING
      // was written, so the job is re-read and the quiet conflict line says
      // so — the same protocol the review patch follows.
      if (error instanceof ApiError && error.status === 409 && error.details.code === "rev_conflict") {
        review.signalConflict();
        return;
      }
      // Any OTHER 409 says the run moved on: a part that is not open any
      // more, a run that has produced nothing yet (an accept while it is
      // still running is allowed, so "nothing finished yet" is a real answer).
      // Nothing was written — re-read and say so in one line.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      }
    },
    onSuccess: (data) => {
      const labels = [
        ...data.scenes.map(sceneLabel),
        ...data.npcs.map(npcLabel),
        ...data.locations.map(locationLabel),
      ];
      // ONLY the answer decides: a bulk accept whose rest did not settle the
      // run leaves the job there, and marking it dropped up front turned a
      // job that is still open into one that had vanished.
      if (data.jobDeleted) {
        droppedRef.current = true;
        setWritten((prev) => [...(prev ?? []), ...labels]);
        if (data.npcs[0] !== undefined) setWrittenNpc(data.npcs[0]);
      }
      // The scenes, npcs and locations exist now — the chapter overview and
      // the lists have to show them.
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: npcsKey(campaign) });
      void queryClient.invalidateQueries({ queryKey: locationsKey(campaign) });
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
  });

  // Discarding: drops the server's job and with it the OPEN REST only —
  // parts a partial accept already wrote are in the campaign now, not a job.
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
   * The part the retry action handed the focus to, until the focus is
   * actually sitting on its card.
   *
   * Focusing once in `onSuccess` is not enough: the
   * button unmounts the moment the part goes `running`, and the status card
   * itself unmounts the moment the part is `done` and becomes its draft card
   * — with a fast model both happen within a poll of the click, so the focus
   * would fall to `body` and a keyboard DM would land at the top of the page
   * (quality floor: focus stays visible and where the work is). So the focus
   * FOLLOWS the part across those swaps, once per commit, and stops as soon
   * as the part is settled or the DM has moved the focus themselves.
   */
  const focusPart = useRef<string | undefined>(undefined);

  /** Retrying one failed part. */
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
      // A 409 here does not mean the server is broken: the part is already
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
   * `isError` rendered in a global spot would show the retry failure next to
   * every card and never clear. `retry.variables` is the key of the last
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
  const proposalParts = parts.filter((part) => part.kind !== "scene");
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
  /** The proposed scene of a finished scene part, by its id. */
  const sceneOfPart = (part: GenerateJobPart) => scenes.find((scene) => scene.id === part.id);
  const npcOfPart = (part: GenerateJobPart) =>
    part.kind === "npc" ? proposedNpcs.find((npc) => npc.id === part.id) : undefined;
  const locationOfPart = (part: GenerateJobPart) =>
    part.kind === "location"
      ? proposedLocations.find((location) => location.id === part.id)
      : undefined;
  /** Npcs and locations in the result that no PART accounts for (see the list below). */
  const unclaimedNpcs = proposedNpcs.filter(
    (npc) => !proposalParts.some((part) => part.kind === "npc" && part.id === npc.id),
  );
  const unclaimedLocations = proposedLocations.filter(
    (location) =>
      !proposalParts.some((part) => part.kind === "location" && part.id === location.id),
  );

  /** One proposed npc of the run, decided and accepted by its id (ADR #31). */
  const npcRow = (npc: NpcProposal, cardRef?: (el: HTMLElement | null) => void) => (
    <NpcProposalRow
      key={`npc:${npc.id}`}
      campaign={campaign}
      npc={npc}
      {...(cardRef === undefined ? {} : { cardRef })}
      reason={proposalReason(scenes, t)}
      decision={reviewState.npcs[npc.id]}
      state={npcState(job, npc.id)}
      busy={apply.isPending}
      onDecide={(decision) => review.decide({ npcs: { [npc.id]: decision ?? null } })}
      onAccept={() => apply.mutate({ npcs: [npc.id] })}
    />
  );
  /** One proposed location of the run, decided and accepted by its id (ADR #31). */
  const locationRow = (
    location: LocationProposal,
    cardRef?: (el: HTMLElement | null) => void,
  ) => (
    <LocationProposalRow
      key={`location:${location.id}`}
      campaign={campaign}
      location={location}
      {...(cardRef === undefined ? {} : { cardRef })}
      reason={proposalReason(scenes, t)}
      decision={reviewState.locations[location.id]}
      state={locationState(job, location.id)}
      busy={apply.isPending}
      onDecide={(decision) => review.decide({ locations: { [location.id]: decision ?? null } })}
      onAccept={() => apply.mutate({ locations: [location.id] })}
    />
  );

  /** One proposed scene of the run, edited, dropped and accepted by its id (ADR #31). */
  const sceneCard = (proposed: SceneProposal, cardRef?: (el: HTMLElement | null) => void) => (
    <SceneProposalCard
      key={proposed.id}
      campaign={campaign}
      scene={sceneFor(proposed)}
      tree={tree.data}
      state={sceneState(job, proposed.id)}
      busy={apply.isPending}
      editing={editing[proposed.id] === true}
      {...(cardRef === undefined ? {} : { cardRef })}
      onToggleEditing={() =>
        setEditing((prev) => ({ ...prev, [proposed.id]: prev[proposed.id] !== true }))
      }
      onChange={(change) => editScene(proposed.id, change)}
      // Leaving a field is the last cheap moment to be sure.
      onFlush={review.flush}
      onAccept={() => apply.mutate({ scenes: [proposed.id] })}
      onDrop={() =>
        review.decide({
          droppedScenes: reviewState.droppedScenes.includes(proposed.id)
            ? reviewState.droppedScenes.filter((id) => id !== proposed.id)
            : [...reviewState.droppedScenes, proposed.id],
        })
      }
    />
  );

  const applied = written !== undefined;
  // The window between the click and this run's job being readable is the
  // working state — and NOTHING else is: the moment the job
  // answers, the job decides, even while its own 202 is still on the way.
  // A fast run is finished before that response arrives, and making the
  // request's lifetime the spinner's would leave the DM in front of a done run.
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
  // A failed job carries the same body the endpoint answers with:
  // the last raw reply and (when the endpoint reports usage) what the run
  // cost — a truncated reply additionally carries an error CODE instead of a
  // validation error list, and serverErrorBodyMessage turns that
  // code into this language's sentence.
  // Shown only in ITS OWN mode: after switching to the other mode the block
  // would talk about a run this form cannot repeat.
  const failed = jobKind === mode ? jobErrorBody(job) : undefined;
  const validationErrors = stringList(failed?.validationErrors);
  const rawReply = stringField(failed?.rawReply);
  const failedUsage = usageLabel(failed?.usage, t);
  const failedMessage = serverErrorBodyMessage(failed, t);
  const resultUsage = usageLabel(result?.usage ?? npcResult?.usage, t);
  // A write conflict names what is in the way: the chapter, the scenes, npcs
  // and locations, each by its resource segment and id.
  const conflicts =
    apply.error instanceof ApiError && apply.error.status === 409
      ? [
          ...stringList(apply.error.details.chapters).map(chapterLabel),
          ...stringList(apply.error.details.scenes).map(sceneLabel),
          ...stringList(apply.error.details.npcs).map(npcLabel),
          ...stringList(apply.error.details.locations).map(locationLabel),
        ]
      : [];

  const canGenerate =
    campaign !== "" &&
    !starting &&
    (mode === "npc"
      ? npcRun.ready
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

            {/* The mode switch: two quiet chips, same vocabulary
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

            {mode === "npc" && <NpcRunFields form={npcRun} />}

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

                {/* The new-chapter flow: display name + the id.
                    The id is the field that decides where the drafts land,
                    and the DM owns it, because renaming a chapter later is
                    expensive (ids are stable references). The title is only
                    the display name and is meaningless for an id that already
                    exists. */}
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
                      // back to the title.
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
                their own (PO feedback): this line is
                exactly where the DM notices a rule is missing, and it should
                be one click from here to the page that fixes it. */}
            <p className="mt-2.5 mb-[26px] flex flex-wrap items-baseline gap-1.5 text-[12px] leading-[1.5] text-faint">
              <span>{t("generate.input.contextLabel")}</span>
              <span className="text-muted-foreground">
                {contextHint(tree.data?.npcs.length ?? 0, tree.data?.locations.length ?? 0, t)}
              </span>
              <span aria-hidden>·</span>
              <Link to={`/campaigns/${campaign}/knowledge`} className={CONTEXT_LINK}>
                {knowledgeHint(promptKnowledgeCount(knowledge.data?.entries ?? []), t)}
              </Link>
              <span aria-hidden>·</span>
              <Link to={`/campaigns/${campaign}/glossary`} className={CONTEXT_LINK}>
                {t(
                  (glossary.data?.entries.length ?? 0) > 0
                    ? "generate.input.glossary"
                    : "generate.input.noGlossary",
                )}
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
                ends. A restart is NOT one of the reasons any
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
            never on a result being there: in a pipelined
            run the parts are the review's spine and the drafts only fill it
            in, so a run whose sole reviewable part FAILED has something to
            show (its error and its retry action) while `result` is
            still empty. Gating on the result rendered that state as an empty
            page, and the run only became visible on a reload. */}
        {phase === "review" && jobKind === "scene" && (
          <>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
              <h1 className="font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
                {t("generate.review.title")}
              </h1>
              {/* THE live region of the review (quality floor): the run's
                  progress is announced here and nowhere else — never one
                  live region per part card. */}
              <span aria-live="polite" className="text-[13px] text-muted-foreground">
                {/* While the RUN is still going its own progress is the more
                    useful number — how many parts of the run are done;
                    once it is finished, the review's is. */}
                {runProgress ??
                  (progress.written === 0
                    ? t("generate.review.pending", {
                        summary: applySummary(
                          scenes.length,
                          proposedNpcs.length + proposedLocations.length,
                          t,
                        ),
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
            {/* What the run cost — quiet, but never invisible.
                A pipelined run reports its own totals, summed over every part
                and every correction turn, and counts CALLS rather than
                attempts. */}
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

            <ChapterDescription description={job?.pipeline?.chapterDescription} t={t} />

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

            {/* The parts in OUTLINE order: a finished one is its
                draft, an open one a status card, a failed one its error plus
                its retry action. A run without parts — an older job — falls
                back to the plain draft list below. */}
            {sceneParts.map((part) => {
              const scene = part.status === "done" ? sceneOfPart(part) : undefined;
              if (scene === undefined) {
                return (
                  <PartCard
                    key={part.key}
                    part={part}
                    // A part that says `done` and has no draft in the result
                    // is a broken run, not a waiting one.
                    mismatch={part.status === "done"}
                    busy={retryBusy(part.key)}
                    error={retryError(part.key)}
                    cardRef={(el) => partCards.current.set(part.key, el)}
                    onRetry={() => retry.mutate(part.key)}
                  />
                );
              }
              return sceneCard(scene, (el) => partCards.current.set(part.key, el));
            })}

            {sceneParts.length === 0 &&
              scenes.map((scene) => sceneCard(scene))}

            {(proposedNpcs.length > 0 ||
              proposedLocations.length > 0 ||
              proposalParts.length > 0) && (
              <>
                <div className={cn(OVERLINE, "mb-2.5")}>{t("generate.review.stubsHeading")}</div>
                {proposalParts.map((part) => {
                  const npc = part.status === "done" ? npcOfPart(part) : undefined;
                  const location = part.status === "done" ? locationOfPart(part) : undefined;
                  const cardRef = (el: HTMLElement | null) => partCards.current.set(part.key, el);
                  if (npc !== undefined) return npcRow(npc, cardRef);
                  if (location !== undefined) return locationRow(location, cardRef);
                  return (
                    <PartCard
                      key={part.key}
                      part={part}
                      mismatch={part.status === "done"}
                      busy={retryBusy(part.key)}
                      error={retryError(part.key)}
                      cardRef={cardRef}
                      onRetry={() => retry.mutate(part.key)}
                    />
                  );
                })}
                {/* Npcs and locations no part claims: a run whose outline
                    proposed nothing but whose SCENE replies carried them, and
                    one whose part id drifted. */}
                {unclaimedNpcs.map((npc) => npcRow(npc))}
                {unclaimedLocations.map((location) => locationRow(location))}
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
                {/* A refusal the server names — a run whose chapter is gone,
                    say — is its own sentence; everything else the review's. */}
                {apply.error instanceof ApiError && apply.error.status === 409
                  ? t("generate.review.applyStale")
                  : serverErrorMessage(apply.error, t, "generate.review.applyFailed")}
              </p>
            )}
            {discard.isError && (
              <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
                {t("generate.review.discardFailed")}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-[18px]">
              {/* The accept-all action writes what is LEFT — the count follows
                  the partial accepts instead of promising the whole run
                  again. */}
              <Button
                type="button"
                disabled={
                  apply.isPending ||
                  openProposedScenes.length +
                    openAcceptedNpcs.length +
                    openAcceptedLocations.length ===
                    0
                }
                onClick={() => apply.mutate(undefined)}
                className="h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
              >
                {t(progress.written === 0 ? "generate.review.apply" : "generate.review.applyRest", {
                  count: applySummary(
                    openProposedScenes.length,
                    openAcceptedNpcs.length + openAcceptedLocations.length,
                    t,
                  ),
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
              {rest.length + restNpcs.length + restLocations.length === 0 &&
                progress.written > 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  {t("generate.review.allDecided")}
                </p>
              )}
            </div>
          </>
        )}

        {/* The NPC run's review lives in the npc's slice; mounted per job,
            so a new run starts with a clean typing buffer. */}
        {phase === "review" && npcResult !== undefined && job !== null && (
          <NpcRunReview
            key={job.id}
            job={job}
            result={npcResult}
            tree={tree.data}
            review={review}
            usage={resultUsage}
            hints={<NamingHints hints={npcResult.namingHints} t={t} />}
            conflicts={conflicts}
            applyProblem={
              apply.isError && conflicts.length === 0
                ? apply.error instanceof ApiError && apply.error.status === 409
                  ? "stale"
                  : "failed"
                : undefined
            }
            discardFailed={discard.isError}
            applying={apply.isPending}
            discarding={discard.isPending}
            onApply={() => apply.mutate(undefined)}
            onDiscard={() => discard.mutate()}
          />
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
              {mode === "npc" && writtenNpc !== undefined && (
                <NpcRunWrittenAction campaign={campaign} id={writtenNpc} />
              )}
              <Button
                type="button"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
                  void navigate(`/campaigns/${campaign}`);
                }}
                className="h-auto px-4 py-2.5 text-[13px] font-semibold"
              >
                {t("generate.written.toChapters")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The API has no reason field per proposal — the honest reason is the batch
 * the proposal came out of, so the row names the scene(s) of this run.
 */
function proposalReason(scenes: GenerateResult["scenes"], t: Translate): string {
  const first = scenes[0];
  if (first === undefined) return t("generate.stub.reason.run");
  const title = first.title === "" ? first.id : first.title;
  return t(scenes.length === 1 ? "generate.stub.reason.scene" : "generate.stub.reason.scenes", {
    title,
  });
}

/**
 * The naming check's findings — the ONE block on this page
 * that is not the model's voice but the server's.
 *
 * It is deliberately QUIETER than the warnings above it: a hairline box, no
 * accent border, one small heading that calls the findings non-blocking. The
 * check is a plain text search (server/src/naming-check.ts) and can be wrong
 * about whether a hit is the thing the rule meant, so it may not look like a
 * verdict — and it must never compete with the draft the DM is reading.
 *
 * Nothing renders when there is nothing to say: a box announcing zero hints
 * would be noise on every single run of every campaign without conventions.
 */
/**
 * The description of the chapter a new-chapter run creates — the text
 * that chapter starts with once the run is accepted. It comes from the
 * outline, so it stands above the drafts, rendered like the chapter overview
 * will show it. Read-only: the review edits drafts, and the chapter's text is
 * the DM's to change afterwards in the chapter overview. A run into an
 * existing chapter has none, and nothing is shown.
 */
function ChapterDescription({
  description,
  t,
}: {
  description: string | undefined;
  t: Translate;
}) {
  if (description === undefined || description.trim() === "") return null;
  return (
    <section className="mb-[22px] rounded-md border border-border bg-card px-3.5 py-3">
      <h2 className={cn(OVERLINE, "mb-2")}>{t("generate.review.chapterDescription")}</h2>
      <div className="md-compact">
        <Markdown>{description}</Markdown>
      </div>
    </section>
  );
}

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
        {hints.map((hint, index) => {
          // WHAT the hit sits in: a proposed scene, npc or location by its
          // resource segment and id (ADR #31).
          const where =
            hint.scene !== undefined
              ? sceneLabel(hint.scene)
              : hint.npc !== undefined
                ? npcLabel(hint.npc)
                : locationLabel(hint.location ?? "");
          // The key needs every coordinate: one rule can hit the same draft
          // twice (a field and a body line), and two rules can hit the same
          // line. The index closes the remaining tie.
          return (
            <li key={`${where}:${hint.field}:${hint.line ?? 0}:${hint.from}:${index}`}>
              <p className="text-[13px] leading-[1.5] text-soft">
                {t("generate.review.namingHint", { from: hint.from, to: hint.to })}
              </p>
              <p className="mt-0.5 font-mono text-[11.5px] text-faint">
                {hint.line === undefined
                  ? t("generate.review.namingWhereField", { path: where, field: hint.field })
                  : t("generate.review.namingWhereBody", { path: where, line: hint.line })}
              </p>
              {/* The line itself, so the DM can judge the hit without opening
                  the draft — the check's whole claim is that the draft says
                  this. */}
              <p className="mt-0.5 text-[12px] leading-[1.5] text-muted-foreground">
                {hint.excerpt}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The working state: spinner + the correction-turn explainer + the one fact
 * that matters — the run is on the server, so the tab may
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
 * One part of a pipelined run that has no draft to show yet:
 * waiting, being written, or failed.
 *
 * It is deliberately the SAME footprint as a draft card, in the same place in
 * the list — the review is laid out in outline order, and a part that moves
 * from being written to a finished scene must not make everything below
 * it jump. Quieter than a draft: a hairline card, the title the outline gave
 * the part, and one line saying what is going on.
 *
 * A failed part is the only one with a button. WHY it failed is said in this
 * language (the raw server sentence about failed mechanical validation is
 * English and is the DM's only headline otherwise), with
 * the mechanical error list unchanged below it and the raw reply behind the
 * same disclosure the whole-run failure uses — the DM decides from it whether
 * to retry or to drop the run.
 *
 * `mismatch` is the third failure there is: a part the server calls `done`
 * whose draft is not in the result.
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
      // Focusable only programmatically: the retry action unmounts its own
      // button, so the retry hands the focus to the card instead of letting
      // it fall to `body`. Not a live region — the review
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
          {/* WHAT came back — the same disclosure the whole-run failure uses. The part carries its own last raw reply. */}
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
