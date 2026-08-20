// "/:campaign/generate" — the LLM generator (issue #12) per the design
// reference's GENERATOR section, four states in one route:
//
//   input   target chapter (existing chip or the "Neues Kapitel" flow with
//           a live path preview) + source text + the context hint
//   working the spinner while the SERVER's job runs (correction turns happen
//           inside that job, generator/README.md)
//   review  the drafts of a finished job: rendered through the SAME markdown
//           pipeline as a real scene, editable as raw markdown, stubs
//           accepted/rejected one by one. NOTHING is on disk yet.
//   done    the paths POST /generate/apply wrote — all as drafts
//
// Since issue #19 the run is a background JOB on the server and this route
// is only its window: on mount it asks GET …/generate/job and restores
// whatever it finds (running -> working with ~3s polling, done -> review
// incl. the edits kept in the job, failed -> the error block). That is the
// whole point of the ticket: a browser-back gesture, a reload or a closed
// tab may not destroy minutes of generation any more.
//
// A failed run stays in the input state and shows the server's 422 in full
// (issue #18): the message (for a truncated reply the one naming
// LLM_MAX_TOKENS), the validation errors when there are any, the last raw
// reply behind a collapsed „Rohantwort anzeigen“, and the run's token spend.
//
// Local state is only what the server cannot know: the current edit buffers
// (mirrored into the job, debounced, so they survive too), which cards are
// in edit mode, the stub decisions, and the paths a finished apply wrote.
// Stub decisions are deliberately NOT persisted — re-deciding two rows is
// cheap, and nothing is lost on disk.

import type { CampaignTree, GenerateResult, GeneratedStub } from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Check,
  GitFork,
  MapPin,
  PenLine,
  Sparkles,
  StickyNote,
  User,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  ApiError,
  applyDrafts,
  deleteGenerateJob,
  fetchFile,
  fetchTree,
  startGenerateJob,
} from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { Button } from "@/components/ui/button";
import { locationName } from "@/lib/campaign";
import { fmString, fmStringArray } from "@/lib/frontmatter";
import {
  applySummary,
  contextHint,
  generatePhase,
  jobErrorBody,
  markdownBody,
  newChapterId,
  stringField,
  stringList,
  usageLabel,
} from "@/lib/generate";
import { generateJobKey, useDraftEditSync, useGenerateJob } from "@/lib/use-generate-job";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

/** Which chapter the drafts are for: an existing one, or a new one. */
type Target = { kind: "chapter"; id: string } | { kind: "new" };

type StubDecision = "accepted" | "rejected";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";
const FIELD =
  "w-full rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-border-hover";
const CHIP = "rounded-full border px-3.5 py-[5px] text-[12.5px]";
const CHIP_ON =
  "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-hover";
const CHIP_OFF =
  "border-border bg-card text-body-secondary hover:border-border-hover hover:text-foreground";

/** Stub identity — kind + id is unique inside one result. */
const stubKey = (stub: GeneratedStub) => `${stub.kind}:${stub.id}`;

export function GenerateRoute() {
  const { campaign = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  // Only for the context hint: the server sends glossary.md along with the
  // prompt when it exists (generator/README.md step 1). A missing file is a
  // 404 and means "no glossary" — not an error worth retrying.
  const glossary = useQuery({
    queryKey: ["file", campaign, "glossary.md"],
    queryFn: () => fetchFile(campaign, "glossary.md"),
    enabled: campaign !== "",
    retry: false,
  });

  const chapters = tree.data?.chapters ?? [];
  const chapterIds = chapters.map((c) => c.id);
  // Default target: the active chapter (fallback: the first) — the rule the
  // live nav and the review use as well.
  const defaultChapter = (chapters.find((c) => c.status === "active") ?? chapters[0])?.id;

  const [picked, setPicked] = useState<Target>();
  const target: Target =
    picked ?? (defaultChapter === undefined ? { kind: "new" } : { kind: "chapter", id: defaultChapter });
  const [newTitle, setNewTitle] = useState("");
  const [sourceText, setSourceText] = useState("");

  const newId = newChapterId(newTitle, chapterIds);
  const chapterId = target.kind === "new" ? newId : target.id;

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, StubDecision>>({});
  const [written, setWritten] = useState<string[]>();

  // The server's job IS the state of a run (issue #19).
  const jobQuery = useGenerateJob(campaign);
  const job = jobQuery.data ?? null;
  const jobId = job?.id ?? null;
  const syncEdit = useDraftEditSync(campaign, job?.id);

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
    setEdits(job?.draftEdits ?? {});
    setEditing({});
    setDecisions({});
    if (previous === undefined) setWritten(undefined);
    // Gone without us applying or discarding it: the server was restarted.
    setLostJob(jobId === null && previous !== undefined && previous !== null && !droppedRef.current);
    if (jobId === null) droppedRef.current = false;
  }

  const result = job?.status === "done" ? job.result : undefined;
  const scenes = result?.scenes ?? [];
  const stubs = result?.stubs ?? [];
  const acceptedStubs = stubs.filter((s) => decisions[stubKey(s)] === "accepted");

  const start = useMutation({
    mutationFn: () =>
      startGenerateJob(campaign, {
        chapter: chapterId as string,
        sourceText,
        newChapter: target.kind === "new",
      }),
    // 202 (or an adopted 409 — the api client hands back the running job's
    // id): from here on the job query drives the view.
    onSuccess: () => {
      setLostJob(false);
      setWritten(undefined);
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
  });

  const apply = useMutation({
    mutationFn: () =>
      applyDrafts(campaign, {
        scenes: scenes.map((s) => ({ path: s.path, markdown: edits[s.path] ?? s.markdown })),
        stubs: acceptedStubs,
        // The new chapter's _chapter.md is created in the same batch.
        ...(target.kind === "new" && chapterId !== undefined
          ? { chapter: chapterId, chapterTitle: newTitle.trim() }
          : {}),
        // The server drops the job once the drafts are on disk.
        ...(job === null ? {} : { jobId: job.id }),
      }),
    onMutate: () => {
      droppedRef.current = true;
    },
    onSuccess: (data) => {
      setWritten(data.written);
      // The drafts exist now — the pool has to show them.
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
  });

  // "Verwerfen": nothing was written, so this only drops the server's job.
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

  const applied = written !== undefined;
  // The window between "POST /generate answered" and "the job shows up in
  // the query" is still the working state — nothing else would be honest.
  const starting = start.isPending || (start.isSuccess && job === null && !applied);
  const phase = generatePhase({
    applied,
    starting,
    jobChecked: jobQuery.isSuccess || jobQuery.isError,
    ...(job === null ? {} : { jobStatus: job.status }),
  });

  const startError = start.error instanceof ApiError ? start.error : undefined;
  // A failed job carries the same body the endpoint used to answer with:
  // the last raw reply and (when the endpoint reports usage) what the run
  // cost — a truncated reply additionally carries the server's German
  // LLM_MAX_TOKENS message instead of a validation error list (issue #18).
  const failed = jobErrorBody(job);
  const validationErrors = stringList(failed?.validationErrors);
  const rawReply = stringField(failed?.rawReply);
  const failedUsage = usageLabel(failed?.usage);
  const failedMessage = stringField(failed?.error);
  const resultUsage = usageLabel(result?.usage);
  const conflicts = apply.error instanceof ApiError && apply.error.status === 409
    ? stringList(apply.error.details.conflicts)
    : [];

  const canGenerate =
    campaign !== "" && chapterId !== undefined && sourceText.trim() !== "" && !starting;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[680px] px-5 pt-8 pb-24 md:px-7 md:pt-10 md:pb-[100px]">
        {phase === "input" && (
          <>
            <h1 className="mb-2 font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
              Szenen generieren
            </h1>
            <p className="mb-7 text-[14px] leading-[1.6] text-body-secondary">
              Englisches Quellmaterial rein, deutsche Szenen-Drafts raus. Immer status draft,
              immer mit Review — geschrieben wird erst beim Übernehmen.
            </p>

            <div className={cn(OVERLINE, "mb-2")} id="gen-target-label">
              Ziel-Kapitel
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
                Neues Kapitel
              </button>
            </div>

            {target.kind === "new" && (
              <div className="mt-[-10px] mb-[22px] flex flex-col gap-[7px]">
                <label htmlFor="gen-new-title" className="sr-only">
                  Kapiteltitel
                </label>
                <input
                  id="gen-new-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Kapiteltitel, z. B. Die Schmugglerbucht"
                  className={cn(FIELD, "max-w-[320px] py-2.5")}
                />
                {newId !== undefined && (
                  <p className="font-mono text-[11.5px] text-faint">wird angelegt als: {newId}</p>
                )}
              </div>
            )}

            <label htmlFor="gen-source" className={cn(OVERLINE, "mb-2 block")}>
              Quelltext (EN)
            </label>
            <textarea
              id="gen-source"
              rows={12}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Abenteuertext einfügen — Absätze, Boxed Text, Statblock-Verweise …"
              className={cn(FIELD, "resize-y leading-[1.6] text-body")}
            />
            <p className="mt-2.5 mb-[26px] flex flex-wrap items-baseline gap-1.5 text-[12px] leading-[1.5] text-faint">
              <span>Mitgeschickter Kontext:</span>
              <span className="text-muted-foreground">
                {contextHint(
                  tree.data?.npcs.length ?? 0,
                  tree.data?.locations.length ?? 0,
                  glossary.isSuccess,
                )}
              </span>
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
              Entwürfe generieren
            </Button>

            {tree.isError && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                Kapitel nicht ladbar — Grimoire-Server auf Port 3000 starten.
              </p>
            )}

            {/* Jobs live in memory only (issue #19, bewusstes Nicht-Ziel):
                after a server restart the run is gone — said once, quietly,
                instead of a spinner that never ends. */}
            {lostJob && (
              <p aria-live="polite" className="mt-4 text-[13px] text-muted-foreground">
                Der Generierungs-Job ist nicht mehr vorhanden (Server-Neustart?) — erneut
                starten.
              </p>
            )}

            {startError?.status === 503 && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                ANTHROPIC_API_KEY fehlt — siehe server/.env
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
                    ? "Das Modell hat die Formprüfung nicht bestanden — nichts generiert."
                    : (failedMessage ??
                      "Das Modell hat keine verwertbare Antwort geliefert — nichts generiert.")}
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
                      Quelltext kürzen oder klarer strukturieren und erneut generieren.
                    </p>
                  </>
                )}
                {rawReply !== undefined && (
                  <details className="mt-2.5">
                    <summary className="cursor-pointer text-[12.5px] text-body-secondary hover:text-foreground">
                      Rohantwort anzeigen
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
                no ApiError at all) stays one honest line. */}
            {start.isError && startError?.status !== 503 && (
              <p aria-live="polite" className="mt-4 text-[13px] text-destructive">
                {startError?.status === 404
                  ? "Kapitel nicht gefunden — anderes Ziel wählen."
                  : "Nicht generiert — Server prüfen."}
              </p>
            )}
          </>
        )}

        {/* The first job lookup: one request, and until it answers neither
            the form nor a spinner would be honest — a running job would
            flash the empty form. */}
        {phase === "checking" && <div className="py-24 md:py-[120px]" />}

        {phase === "working" && <Working />}

        {phase === "review" && result !== undefined && (
          <>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
              <h1 className="font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
                Review
              </h1>
              <span className="text-[13px] text-muted-foreground">
                {applySummary(scenes.length, stubs.length)} · noch nichts geschrieben
              </span>
            </div>
            <p
              className={cn(
                "text-[14px] leading-[1.6] text-body-secondary",
                resultUsage === undefined ? "mb-[22px]" : "mb-1.5",
              )}
            >
              Prüfen, anpassen, Stubs einzeln entscheiden. Erst „Übernehmen“ schreibt auf die
              Platte — als Drafts, nie überschreibend.
            </p>
            {/* What the run cost — quiet, but never invisible (issue #18). */}
            {resultUsage !== undefined && (
              <p className="mb-[22px] text-[12px] text-faint">{resultUsage}</p>
            )}

            {result.warnings.map((warning) => (
              <div
                key={warning}
                className="mb-2 flex items-start gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3.5 py-2.5"
              >
                <StickyNote aria-hidden size={15} className="mt-px flex-none text-primary" />
                <p className="text-[13px] leading-[1.55] text-soft">{warning}</p>
              </div>
            ))}

            {scenes.map((scene) => (
              <SceneCard
                key={scene.path}
                path={scene.path}
                frontmatter={scene.frontmatter}
                markdown={edits[scene.path] ?? scene.markdown}
                tree={tree.data}
                editing={editing[scene.path] === true}
                onToggleEditing={() =>
                  setEditing((prev) => ({ ...prev, [scene.path]: prev[scene.path] !== true }))
                }
                onChange={(markdown) => {
                  // Local first (the textarea must not lag), then debounced
                  // into the job so the edit survives navigation too.
                  setEdits((prev) => ({ ...prev, [scene.path]: markdown }));
                  syncEdit(scene.path, markdown);
                }}
              />
            ))}

            {stubs.length > 0 && (
              <>
                <div className={cn(OVERLINE, "mb-2.5")}>Stubs — einzeln entscheiden</div>
                {stubs.map((stub) => (
                  <StubRow
                    key={stubKey(stub)}
                    stub={stub}
                    reason={stubReason(scenes)}
                    decision={decisions[stubKey(stub)]}
                    onDecide={(decision) =>
                      setDecisions((prev) => {
                        const next = { ...prev };
                        if (decision === undefined) delete next[stubKey(stub)];
                        else next[stubKey(stub)] = decision;
                        return next;
                      })
                    }
                  />
                ))}
              </>
            )}

            {conflicts.length > 0 && (
              <div aria-live="polite" className="mb-3 rounded-md border border-input bg-card px-3.5 py-3">
                <p className="mb-1.5 text-[13px] text-foreground">
                  Diese Dateien existieren schon — nichts geschrieben:
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
                Nicht geschrieben — Server prüfen.
              </p>
            )}
            {discard.isError && (
              <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
                Nicht verworfen — Server prüfen.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-[18px]">
              <Button
                type="button"
                disabled={apply.isPending || scenes.length === 0}
                onClick={() => apply.mutate()}
                className="h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
              >
                Übernehmen ({applySummary(scenes.length, acceptedStubs.length)})
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={apply.isPending || discard.isPending}
                onClick={() => discard.mutate()}
                className="h-auto border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                Verwerfen
              </Button>
            </div>
          </>
        )}

        {phase === "done" && written !== undefined && (
          <div className="flex flex-col items-start gap-3.5 py-14 md:py-20">
            <p className="flex items-center gap-2.5 text-[15px] text-foreground">
              <Check aria-hidden size={17} className="flex-none text-success-text" />
              Geschrieben — alles als draft
            </p>
            <ul className="flex flex-col gap-1.5">
              {written.map((path) => (
                <li key={path} className="font-mono text-[12.5px] text-body-secondary">
                  {path}
                </li>
              ))}
            </ul>
            <p className="max-w-[420px] text-[13px] leading-[1.6] text-muted-foreground">
              Die Szenen erscheinen im Pool mit Status „Entwurf“. Bestehende Dateien werden nie
              überschrieben — bei Konflikt schreibt der Server nichts.
            </p>
            <Button
              type="button"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
                void navigate(`/${campaign}`);
              }}
              className="mt-2 h-auto px-4 py-2.5 text-[13px] font-semibold"
            >
              Zum Pool
            </Button>
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
function stubReason(scenes: GenerateResult["scenes"]): string {
  const first = scenes[0];
  if (first === undefined) return "aus diesem Lauf";
  const title = fmString(first.frontmatter.title) ?? first.path;
  return scenes.length === 1 ? `aus ${title}` : `aus ${title} u. a.`;
}

/**
 * The working state: spinner + the correction-turn explainer + the one fact
 * that matters since issue #19 — the run is on the server, so the tab may
 * go. No number of attempts here: LLM_CORRECTION_TURNS is a server setting
 * (default 1) and a hardcoded "max. 2" would be a lie in half the setups.
 */
function Working() {
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
      <p className="text-[14.5px] text-foreground">Drafts werden generiert …</p>
      <p className="max-w-[380px] text-[13px] leading-[1.6] text-muted-foreground">
        Der Server validiert die Antwort mechanisch; Formfehler gehen automatisch als Korrektur
        ans Modell zurück.
      </p>
      <p className="max-w-[380px] text-[12.5px] leading-[1.6] text-faint">
        Läuft auf dem Server weiter — dieser Tab darf zu. Das Ergebnis wartet hier, bis es
        übernommen oder verworfen wird.
      </p>
    </div>
  );
}

/**
 * One draft as a card: title/pill/edit toggle, mono target path, the chip row
 * from the frontmatter, then either the rendered body (same markdown pipeline
 * as a real scene) or the raw markdown in a mono textarea. Title and chips
 * come from the frontmatter the SERVER parsed — raw edits show up in the
 * preview and on apply, not in the card's header.
 */
function SceneCard({
  path,
  frontmatter,
  markdown,
  tree,
  editing,
  onToggleEditing,
  onChange,
}: {
  path: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
  tree: CampaignTree | undefined;
  editing: boolean;
  onToggleEditing: () => void;
  onChange: (markdown: string) => void;
}) {
  const title = fmString(frontmatter.title) ?? path;
  const status = fmString(frontmatter.status) ?? "draft";
  const isContingency = fmString(frontmatter.type) === "contingency";
  const location = locationName(tree, fmString(frontmatter.location));
  const tags = fmStringArray(frontmatter.tags);
  const textareaId = `gen-raw-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  return (
    <div className="my-4 rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--card)_60%,var(--background))] px-5 py-5 md:px-6">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <h2 className="flex-1 font-serif text-[20px] leading-[1.3] font-semibold text-foreground">
          {title}
        </h2>
        <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
          {status}
        </span>
        <Button
          type="button"
          variant="outline"
          aria-expanded={editing}
          aria-controls={editing ? textareaId : undefined}
          onClick={onToggleEditing}
          className="h-auto flex-none gap-1.5 border-input bg-transparent px-2.5 py-[5px] text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground [&_svg]:size-[13px]"
        >
          <PenLine aria-hidden />
          {editing ? "Vorschau" : "Bearbeiten"}
        </Button>
      </div>
      <p className="mb-3.5 font-mono text-[11.5px] text-faint">{path}</p>
      <div className="mb-2 flex flex-wrap gap-2 border-b border-border pb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-soft">
          {isContingency ? (
            <GitFork aria-hidden size={13} className="flex-none text-muted-foreground" />
          ) : (
            <Bookmark aria-hidden size={13} className="flex-none text-muted-foreground" />
          )}
          {isContingency ? "Kontingenz" : "Geplante Szene"}
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
            #{tag}
          </span>
        ))}
      </div>
      {editing ? (
        <textarea
          id={textareaId}
          rows={22}
          value={markdown}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Roh-Markdown von ${title}`}
          className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-4 py-3.5 font-mono text-[12.5px] leading-[1.6] text-body outline-none focus-visible:border-border-hover"
        />
      ) : (
        <Markdown>{markdownBody(markdown)}</Markdown>
      )}
    </div>
  );
}

/** One stub row: marker, name, mono target path, italic reason, decision. */
function StubRow({
  stub,
  reason,
  decision,
  onDecide,
}: {
  stub: GeneratedStub;
  reason: string;
  decision: StubDecision | undefined;
  onDecide: (decision: StubDecision | undefined) => void;
}) {
  const path = `${stub.kind}s/${stub.id}.md`;
  return (
    <div
      className={cn(
        "mb-[18px] flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5",
        decision === "rejected" && "opacity-55",
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
      {decision === undefined ? (
        <div className="flex flex-none gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide("accepted")}
            className="h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover"
          >
            Annehmen
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide("rejected")}
            className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            Ablehnen
          </Button>
        </div>
      ) : (
        // The done row stays a control so a wrong decision is reversible
        // (the prototype shows a label; a click puts the buttons back).
        <button
          type="button"
          onClick={() => onDecide(undefined)}
          title="Entscheidung zurücknehmen"
          className={cn(
            "flex-none rounded-md px-1.5 py-1 text-[12.5px]",
            decision === "accepted" ? "text-primary-hover" : "text-muted-foreground",
          )}
        >
          {decision === "accepted" ? "Angenommen" : "Abgelehnt"}
        </button>
      )}
    </div>
  );
}
