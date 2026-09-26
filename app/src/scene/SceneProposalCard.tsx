// A scene a generator run proposes, as its card in the run's review: title,
// status pill, edit toggle and its mono label, the chip row out of its fields,
// then either its text through the normal markdown pipeline or the editor over
// its fields and its text — and below, what can be done with it: write it on
// its own, drop it, or, once written, open the scene it became.
//
// Title and chips read the scene the card is given, so a field the DM changes
// shows up in the header as well. What the editor changes is reported as the
// scene's change (`sceneEdits`): the form fields together, the text on its
// own. A written scene is read-only here: it is a scene now, and its reading
// view's own editor owns it.

import type { CampaignTree, SceneChange, SceneProposal } from "@grimoire/shared/types";
import { Bookmark, Check, GitFork, MapPin } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { DraftBodySection, DraftFieldsSection } from "@/components/DraftEditor";
import { MarkdownEditorToggle } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { locationName } from "@/lib/campaign";
import type { PartState } from "@/components/ProposalRow";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

import { SceneFields } from "./SceneFields";
import {
  sceneFormIssues,
  sceneFormValues,
  sceneProposalChange,
  withPendingChips,
  type SceneFormValues,
  type ScenePendingChips,
} from "./scene-form";
import { sceneHref, sceneLabel } from "./scene-links";
import { sceneStatusMeta } from "./scene-status";

export function SceneProposalCard({
  campaign,
  scene,
  tree,
  state,
  busy,
  editing,
  cardRef,
  onToggleEditing,
  onChange,
  onFlush,
  onAccept,
  onDrop,
}: {
  campaign: string;
  /** The proposed scene with the DM's changes laid on top. */
  scene: SceneProposal;
  tree: CampaignTree | undefined;
  /** What became of this scene — a written one is read-only. */
  state: PartState;
  busy: boolean;
  editing: boolean;
  /**
   * Registers this card as what represents its pipeline part right now — the
   * retry's focus follows the part across the swap from status card to this
   * card.
   */
  cardRef?: (el: HTMLElement | null) => void;
  onToggleEditing: () => void;
  onChange: (change: SceneChange) => void;
  /** Send what is pending now — the text surface calls it on blur. */
  onFlush: () => void;
  onAccept: () => void;
  onDrop: () => void;
}) {
  const t = useT();
  const label = sceneLabel(scene.id);
  const editorId = `gen-draft-${label.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const isContingency = scene.type === "contingency";
  const location = locationName(tree, scene.location);
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
          {scene.title === "" ? scene.id : scene.title}
        </h2>
        <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
          {sceneStatusMeta(scene.status, t).label}
        </span>
        {!written && (
          <MarkdownEditorToggle
            editing={editing}
            onToggleEditing={onToggleEditing}
            controlsId={editorId}
          />
        )}
      </div>
      <p className="mb-3.5 font-mono text-[11.5px] text-faint">{label}</p>
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
        {scene.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-muted-foreground"
          >
            {/* The hashtag is the data format's marker, not copy. */}
            {`#${tag}`}
          </span>
        ))}
      </div>
      {editing && !written ? (
        <SceneProposalEditor scene={scene} tree={tree} onChange={onChange} onFlush={onFlush} />
      ) : (
        <Markdown>{scene.body}</Markdown>
      )}
      {written ? (
        <p className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
          <Check aria-hidden size={14} className="flex-none text-success-text" />
          {t("generate.review.partWritten")}
          <Link
            to={sceneHref(campaign, scene.id)}
            className="rounded font-mono text-[11.5px] underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {label}
          </Link>
        </p>
      ) : (
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
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onDrop}
            className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            {t(state === "dropped" ? "generate.review.undrop" : "generate.review.drop")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The editor of a proposed scene: its fields as in the dialog, its text on
 * the body editor's surfaces. Seeded ONCE, so it is mounted per proposal:
 * re-reading the scene out of the props would fight the keystroke that
 * produced it. Nothing here blocks anything — what an unfinished field would
 * block in the dialog is said under that field and no more: the scene is
 * written by the accept, and the server checks it then.
 */
export function SceneProposalEditor({
  scene,
  tree,
  onChange,
  onFlush,
}: {
  scene: SceneProposal;
  tree: CampaignTree | undefined;
  onChange: (change: SceneChange) => void;
  onFlush: () => void;
}) {
  const t = useT();
  const label = sceneLabel(scene.id);
  const [values, setValues] = useState<SceneFormValues>(() => sceneFormValues(scene));
  const [pending, setPending] = useState<ScenePendingChips>({});
  const edit = (nextValues: SceneFormValues, nextPending: ScenePendingChips): void => {
    setValues(nextValues);
    setPending(nextPending);
    onChange(sceneProposalChange(withPendingChips(nextValues, nextPending)));
  };
  return (
    <div className="mt-3 flex flex-col gap-4">
      <DraftFieldsSection label={label}>
        <SceneFields
          values={values}
          pending={pending}
          issues={sceneFormIssues(withPendingChips(values, pending), undefined, t)}
          tree={tree}
          onChange={(next) => edit(next, pending)}
          onPendingChange={(next) => edit(values, next)}
        />
      </DraftFieldsSection>
      <DraftBodySection
        label={label}
        body={scene.body}
        onBodyChange={(body) => onChange({ body })}
        onFlush={onFlush}
      />
    </div>
  );
}
