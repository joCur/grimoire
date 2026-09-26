// The NPC run of the generator (routes/generate.tsx): source material in,
// ONE proposed npc out. The route shows the mode and owns the job; what the
// run asks for, how its proposal is reviewed and where the written npc opens
// live here.
//
//   input    the source text and the optional id — its own buffers, so
//            switching modes never eats what the DM pasted.
//   review   one card, the same warnings/usage/cost lines and the same two
//            actions as a scene run — there is nothing to decide per item,
//            so no proposal rows and no count in the apply button.
//   done     the action that opens the npc the accept wrote.

import type { CampaignTree, NpcChange } from "@grimoire/shared/types";
import type { GeneratorJob, GenerateNpcResult } from "@grimoire/shared/generator-job";
import { useQueryClient } from "@tanstack/react-query";
import { StickyNote } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { ReviewSaveStatus, type ReviewSaveState } from "@/components/ReviewSaveStatus";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { NpcProposalCard } from "./NpcProposalCard";
import { npcHref } from "./npc-links";
import { npcIdError, npcOf } from "./npc-run";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";
const FIELD =
  "w-full rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-border-hover";

// --- input ------------------------------------------------------------------------

/** The run's form: its two fields, whether it can start, and what it starts with. */
export interface NpcRunForm {
  source: string;
  setSource: (text: string) => void;
  id: string;
  setId: (text: string) => void;
  /** Why the pinned id cannot be used, or undefined. */
  idError: string | undefined;
  /** Source text there and the id usable. */
  ready: boolean;
  /** What the run starts with — the route starts it on the generator job. */
  input: { sourceText: string; id: string };
}

export function useNpcRunForm(tree: CampaignTree | undefined): NpcRunForm {
  const t = useT();
  const [source, setSource] = useState("");
  const [id, setId] = useState("");
  const pinned = id.trim();
  const idError = npcIdError(pinned, (tree?.npcs ?? []).map((npc) => npc.id), t);
  return {
    source,
    setSource,
    id,
    setId,
    idError,
    ready: source.trim() !== "" && idError === undefined,
    input: { sourceText: source, id: pinned },
  };
}

/** The run's two fields: the source text, and the id the DM may pin. */
export function NpcRunFields({ form }: { form: NpcRunForm }) {
  const t = useT();
  const pinned = form.id.trim();
  return (
    <>
      <label htmlFor="gen-npc-source" className={cn(OVERLINE, "mb-2 block")}>
        {t("generate.input.npc.sourceLabel")}
      </label>
      <textarea
        id="gen-npc-source"
        rows={12}
        value={form.source}
        onChange={(e) => form.setSource(e.target.value)}
        placeholder={t("generate.input.npc.sourcePlaceholder")}
        className={cn(FIELD, "resize-y leading-[1.6] text-body")}
      />

      <label htmlFor="gen-npc-id" className="mt-3.5 mb-1.5 block text-[12px] text-muted-foreground">
        {t("generate.input.npc.idLabel")}
      </label>
      <input
        id="gen-npc-id"
        type="text"
        value={form.id}
        onChange={(e) => form.setId(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={form.idError !== undefined}
        aria-describedby="gen-npc-id-note"
        placeholder={t("generate.input.npc.idPlaceholder")}
        className={cn(
          FIELD,
          "max-w-[320px] py-2.5 font-mono text-[12.5px]",
          form.idError !== undefined && "border-destructive focus-visible:border-destructive",
        )}
      />
      <p
        id="gen-npc-id-note"
        aria-live="polite"
        className={cn(
          "mt-[7px] text-[11.5px] leading-[1.5]",
          form.idError !== undefined
            ? "text-destructive"
            : pinned === ""
              ? "text-muted-foreground"
              : "font-mono text-faint",
        )}
      >
        {form.idError ??
          (pinned === ""
            ? t("generate.input.npc.idHint")
            : t("generate.input.npc.idPreview", { id: pinned }))}
      </p>
    </>
  );
}

// --- review -----------------------------------------------------------------------

/**
 * The review of a finished run. Mount it per job (`key`): its typing overlay
 * and its edit toggle belong to that job, and a new run starts clean.
 */
export function NpcRunReview({
  job,
  result,
  tree,
  review,
  usage,
  hints,
  conflicts,
  applyProblem,
  discardFailed,
  applying,
  discarding,
  onApply,
  onDiscard,
}: {
  job: GeneratorJob;
  result: GenerateNpcResult;
  tree: CampaignTree | undefined;
  /** The job's review: its save line, the debounced edit and the flush. */
  review: {
    status: ReviewSaveState;
    editNpc: (id: string, change: NpcChange) => void;
    flush: () => Promise<void>;
  };
  /** The run's token spend, as one quiet line. */
  usage: string | undefined;
  /** The naming hints of the run, rendered by the route. */
  hints: ReactNode;
  /** What stands in the way of the accept, by label. */
  conflicts: readonly string[];
  /** Why the accept failed when nothing stands in the way. */
  applyProblem: "stale" | "failed" | undefined;
  discardFailed: boolean;
  applying: boolean;
  discarding: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  // The TYPING overlay, nothing more: the saved change lives on the job
  // (`job.npcEdits`) and this only keeps the fields from lagging behind the
  // keystroke while the debounced patch is on its way.
  const [typed, setTyped] = useState<NpcChange>();
  const [editing, setEditing] = useState(false);
  const proposed = result.npc;
  return (
    <>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
          {t("generate.review.titleNpc")}
        </h1>
        <span className="text-[13px] text-muted-foreground">{t("generate.review.pendingNpc")}</span>
        <ReviewSaveStatus status={review.status} />
      </div>
      <p
        className={cn(
          "text-[14px] leading-[1.6] text-body-secondary",
          usage === undefined ? "mb-[22px]" : "mb-1.5",
        )}
      >
        {t("generate.review.leadNpc")}
      </p>
      {usage !== undefined && <p className="mb-[22px] text-[12px] text-faint">{usage}</p>}

      {result.warnings.map((warning) => (
        <div
          key={warning}
          className="mb-2 flex items-start gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3.5 py-2.5"
        >
          <StickyNote aria-hidden size={15} className="mt-px flex-none text-primary" />
          <p className="text-[13px] leading-[1.55] text-soft">{warning}</p>
        </div>
      ))}

      {hints}

      <NpcProposalCard
        npc={npcOf(proposed, job.npcEdits?.[proposed.id], typed)}
        tree={tree}
        editing={editing}
        onToggleEditing={() => setEditing((was) => !was)}
        onChange={(change) => {
          setTyped((previous) => ({ ...previous, ...change }));
          review.editNpc(proposed.id, change);
        }}
        onFlush={review.flush}
      />

      {conflicts.length > 0 && (
        <div aria-live="polite" className="mb-3 rounded-md border border-input bg-card px-3.5 py-3">
          <p className="mb-1.5 text-[13px] text-foreground">{t("generate.review.conflictsNpc")}</p>
          <ul className="flex flex-col gap-1">
            {conflicts.map((label) => (
              <li key={label} className="font-mono text-[11.5px] text-body-secondary">
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {applyProblem !== undefined && (
        <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
          {t(applyProblem === "stale" ? "generate.review.applyStale" : "generate.review.applyFailed")}
        </p>
      )}
      {discardFailed && (
        <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
          {t("generate.review.discardFailed")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-[18px]">
        <Button
          type="button"
          disabled={applying}
          onClick={onApply}
          className="h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
        >
          {t("generate.review.applyNpc")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={applying || discarding}
          onClick={onDiscard}
          className="h-auto border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
        >
          {t("common.discard")}
        </Button>
      </div>
    </>
  );
}

// --- done -------------------------------------------------------------------------

/** Open the npc the accept wrote — the run's job is gone by then. */
export function NpcRunWrittenAction({ campaign, id }: { campaign: string; id: string }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
        void navigate(npcHref(campaign, id));
      }}
      className="h-auto border-input bg-transparent px-4 py-2.5 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
    >
      {t("generate.written.openNpc")}
    </Button>
  );
}
