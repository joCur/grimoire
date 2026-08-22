// The Block-Composer (issue #43, phase 2): a scene as a vertical list of
// editable blocks instead of a wall of markdown syntax. This is the DEFAULT
// edit mode of the reading view; „Roh" (the textarea from issue #39) stays one
// click away for everything a form cannot express.
//
// The shape follows the job (UI-BRIEF: „die nächste Information in unter drei
// Sekunden"): a block is a quiet card with its TYPE LABEL — the same vocabulary
// the reading view uses (blockLabel: Vorlesetext, Check, Geheim, …) — and two
// lines of its content, so the DM reads the scene's skeleton in one glance and
// opens exactly the one card they came for.
//
// Every control is a real button, because AK 4 of the ticket is explicit:
// moving and deleting must work with keyboard AND touch, so there is no
// drag-and-drop anywhere here. Reordering happens by re-render, not by
// animation — nothing to gate behind prefers-reduced-motion.
//
// No state that could diverge from the draft: the forms are CONTROLLED and
// write straight into the block list through lib/composer.ts (which routes
// every change through the phase-1 helpers). The only local state is which card
// is expanded and where the type picker is open — pure view state, safe to lose.
//
// A scene is 10–30 blocks and every keystroke hands down a NEW list, so the
// cards are memoized: the props of a card are its own block plus booleans, the
// callbacks are stable for the lifetime of the composer, and the open/picker
// state stays in the list instead of travelling through every card. Typing in
// one open card therefore re-renders that card, not the scene.

import { ChevronDown, ChevronUp, PenLine, Plus, Trash2, X } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { INPUT_CLASS } from "@/components/ui/field";
import { blockLabel, blockText, type HeadingBlock, type SceneBlock } from "@/lib/blocks";
import {
  headingDepths,
  insertAt,
  moveBy,
  newBlockOptions,
  removeAt,
  sameInsertAt,
  setBlockText,
  setHeadingDepth,
  type BlockScope,
  type ComposerMode,
  type InsertAt,
} from "@/lib/composer";
import { cn } from "@/lib/utils";

/** A quiet 32px icon button — the per-block controls and the picker's close. */
const ICON_BUTTON_CLASS =
  "size-8 flex-none rounded-md p-0 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 [&_svg]:size-[15px]";

/**
 * „Blöcke" ⇄ „Roh" — the mode switch of edit mode. A two-button group with
 * aria-pressed instead of a select: both surfaces stay visible and one tap
 * away, which is what a fallback has to be.
 */
export function ComposerModeToggle({
  mode,
  onModeChange,
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Editiermodus"
      className="flex flex-none items-center gap-px rounded-md border border-input p-px"
    >
      {(["blocks", "raw"] as const).map((candidate) => {
        const active = candidate === mode;
        return (
          <Button
            key={candidate}
            type="button"
            variant="ghost"
            aria-pressed={active}
            onClick={() => onModeChange(candidate)}
            className={cn(
              "h-auto rounded-[5px] px-2.5 py-[5px] text-[12px] font-normal",
              active
                ? "bg-secondary text-foreground hover:bg-secondary"
                : "text-body-secondary hover:bg-transparent hover:text-foreground",
            )}
          >
            {candidate === "blocks" ? "Blöcke" : "Roh"}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The type picker of the „+" slot. All options are on screen at once (a wrap of
 * buttons, not a menu): nine names fit a 390px card in three rows, and a picker
 * that needs a popover is one interaction more on the surface that is supposed
 * to make phone editing possible in the first place.
 */
export function BlockTypePicker({
  scope,
  onPick,
  onCancel,
}: {
  scope: BlockScope;
  onPick: (block: SceneBlock) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-[8px] border border-input bg-card p-2.5">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          Block einfügen
        </p>
        <Button
          type="button"
          variant="ghost"
          aria-label="Einfügen abbrechen"
          onClick={onCancel}
          className={cn(ICON_BUTTON_CLASS, "ml-auto size-7")}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {newBlockOptions(scope).map((option) => (
          <Button
            key={option.key}
            type="button"
            variant="outline"
            onClick={() => onPick(option.create())}
            className="h-auto border-input bg-transparent px-2.5 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The typed form of ONE block — the point of the whole composer: the DM fills
 * fields, the markers are the serializer's business.
 *
 *   callout     one textarea for the text; the kind is fixed (changing it would
 *               be a different block) and named by the card's label.
 *   heading     level select plus the text — the two things a heading is.
 *   ifSection   the condition only; its children are cards of their own.
 *   text/raw    markdown as text (ticket non-goal: no WYSIWYG). A raw block's
 *               text INCLUDES its `>` markers, so it stays exactly editable
 *               without ever being reinterpreted.
 */
export function BlockFields({
  block,
  scope,
  idPrefix,
  onText,
  onDepth,
}: {
  block: SceneBlock;
  scope: BlockScope;
  /** Prefix for the control ids — unique per open editor. */
  idPrefix: string;
  onText: (text: string) => void;
  onDepth: (depth: HeadingBlock["depth"]) => void;
}) {
  const id = `${idPrefix}-${block.id}`;
  const label = blockLabel(block);
  const text = blockText(block);

  if (block.type === "heading") {
    return (
      <div className="mt-2 flex flex-wrap items-start gap-1.5">
        <div className="relative flex-none">
          <select
            id={`${id}-depth`}
            value={block.depth}
            aria-label="Ebene der Überschrift"
            onChange={(event) => onDepth(Number(event.target.value) as HeadingBlock["depth"])}
            className={cn(INPUT_CLASS, "w-[104px] appearance-none pr-8")}
          >
            {/* A hand-written level outside the offered range stays selected
                until the DM picks another one — the format degrades. */}
            {headingDepths(scope).includes(block.depth) ? null : (
              <option value={block.depth}>Ebene {block.depth}</option>
            )}
            {headingDepths(scope).map((depth) => (
              <option key={depth} value={depth}>
                Ebene {depth}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            size={14}
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        <input
          id={id}
          value={text}
          aria-label="Text der Überschrift"
          placeholder="Flow"
          autoComplete="off"
          onChange={(event) => onText(event.target.value)}
          className={cn(INPUT_CLASS, "min-w-[140px] flex-1")}
        />
      </div>
    );
  }

  if (block.type === "ifSection") {
    return (
      <div className="mt-2">
        <input
          id={id}
          value={text}
          aria-label="Bedingung des Falls-Abschnitts"
          placeholder="sie geben zu, für Jorna zu arbeiten"
          autoComplete="off"
          onChange={(event) => onText(event.target.value)}
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[11.5px] text-faint">
          Wird als „## If: …" geschrieben und in der Leseansicht einklappbar.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <textarea
        id={id}
        rows={textareaRows(text)}
        value={text}
        aria-label={`Inhalt: ${label}`}
        placeholder={block.type === "callout" ? "Text des Blocks" : "Markdown"}
        onChange={(event) => onText(event.target.value)}
        className={cn(
          INPUT_CLASS,
          // `field-sizing: content` grows the box with the text where the
          // browser has it (a wrapped paragraph on a 390px screen is four
          // visual lines, not one); `rows` stays the fallback everywhere else.
          "field-sizing-content resize-y leading-[1.55]",
          block.type === "raw" && "font-mono text-[12.5px]",
        )}
      />
      {block.type === "raw" && (
        <p className="mt-1 text-[11.5px] text-faint">
          Roh-Markdown mit Markern — wird unverändert übernommen.
        </p>
      )}
    </div>
  );
}

/** Grow with the content, but never take over the page. */
function textareaRows(text: string): number {
  return Math.min(14, Math.max(3, text.split("\n").length + 1));
}

/**
 * The composer. `blocks` and `onChange` are the draft: every edit hands back a
 * new list, the caller (FileBodyEditor) owns it and serializes it for the save.
 */
export function BlockComposer({
  blocks,
  onChange,
  idPrefix,
  label,
  issues,
}: {
  blocks: SceneBlock[];
  onChange: (blocks: SceneBlock[]) => void;
  /** Prefix for the DOM ids of the block forms. */
  idPrefix: string;
  /** What this list belongs to, for the region's accessible name. */
  label: string;
  /**
   * What blocks a save, per block id (lib/composer.ts, composerIssues) — the
   * card says it, the editor's „Speichern" waits for it. Computed by the caller
   * for exactly that reason: one truth for the line and for the button.
   */
  issues: Record<string, string>;
}) {
  // Exactly one card is expanded: on a phone a screen full of open textareas
  // hides the structure the list is there to show. Collapsing loses nothing —
  // the forms write into the draft as they are typed.
  const [openId, setOpenId] = useState<string>();
  const [picker, setPicker] = useState<InsertAt>();

  // The cards are memoized, which only pays off while the props they get stay
  // identical — so `handles` must survive a keystroke. The handlers read the
  // CURRENT list and the current onChange out of a ref instead of closing over
  // them; nothing reads that ref during a render, only in an event handler,
  // which runs long after the commit.
  const latest = useRef({ blocks, onChange });
  latest.current = { blocks, onChange };
  const handles = useMemo<Handles>(
    () => ({
      idPrefix,
      toggleOpen: (id) => setOpenId((current) => (current === id ? undefined : id)),
      openPicker: setPicker,
      insert: (at, block) => {
        latest.current.onChange(insertAt(latest.current.blocks, at, block));
        setPicker(undefined);
        // A fresh block is empty — it opens in its form, otherwise the DM's next
        // click would have to be „bearbeiten" on an empty card.
        setOpenId(block.id);
      },
      setText: (id, text) =>
        latest.current.onChange(setBlockText(latest.current.blocks, id, text)),
      setDepth: (id, depth) =>
        latest.current.onChange(setHeadingDepth(latest.current.blocks, id, depth)),
      move: (id, delta) => latest.current.onChange(moveBy(latest.current.blocks, id, delta)),
      remove: (id) => {
        // No per-block confirm: the editor's discard dialog guards the session,
        // and „Abbrechen" throws the whole draft away unsaved.
        latest.current.onChange(removeAt(latest.current.blocks, id));
        setOpenId((current) => (current === id ? undefined : current));
      },
    }),
    [idPrefix],
  );

  return (
    <section aria-label={`Blöcke: ${label}`} className="mt-3">
      <BlockList
        blocks={blocks}
        scope="document"
        openId={openId}
        picker={picker}
        issues={issues}
        handles={handles}
      />
      {blocks.length === 0 && (
        <p className="mt-1 text-[12.5px] text-faint">
          Noch keine Blöcke — mit „+" den ersten anlegen.
        </p>
      )}
    </section>
  );
}

/**
 * Everything a card needs from the composer, in one prop — CALLBACKS ONLY, and
 * stable for the composer's lifetime. Which card is open and where the picker
 * sits are deliberately NOT in here: as view state they change on every click,
 * and travelling through this object would take every card's memo with them.
 */
interface Handles {
  idPrefix: string;
  toggleOpen: (id: string) => void;
  openPicker: (at: InsertAt | undefined) => void;
  insert: (at: InsertAt, block: SceneBlock) => void;
  setText: (id: string, text: string) => void;
  setDepth: (id: string, depth: HeadingBlock["depth"]) => void;
  move: (id: string, delta: number) => void;
  remove: (id: string) => void;
}

/**
 * One list of blocks with an insert slot before, between and after them.
 *
 * The list is where the view state lives, and it hands each card only the two
 * booleans that concern it. An If-section's children hang off HERE as well (a
 * sibling of the section's own card inside the card's box) instead of being
 * rendered by the card — that is what keeps a card's props free of the whole
 * open/picker/issues state and its memo intact.
 */
function BlockList({
  blocks,
  scope,
  sectionId,
  openId,
  picker,
  issues,
  handles,
}: {
  blocks: SceneBlock[];
  scope: BlockScope;
  /** Set for the children of an If-section — every slot addresses that list. */
  sectionId?: string;
  openId: string | undefined;
  picker: InsertAt | undefined;
  issues: Record<string, string>;
  handles: Handles;
}) {
  return (
    <div className="flex flex-col">
      {blocks.map((block, index) => (
        <div key={block.id} className="flex flex-col">
          <InsertSlot
            sectionId={sectionId}
            index={index}
            scope={scope}
            picking={sameInsertAt(picker, { sectionId, index })}
            handles={handles}
          />
          <div className="rounded-[8px] border border-border bg-card">
            <BlockCard
              block={block}
              scope={scope}
              index={index}
              total={blocks.length}
              open={openId === block.id}
              issue={issues[block.id]}
              handles={handles}
            />
            {block.type === "ifSection" && (
              // The children of the section, indented and with their own slots
              // — the one place where the list nests. Moves stay inside this
              // list.
              <div className="ml-2.5 border-l border-border pb-1.5 pl-2.5 md:ml-3 md:pl-3">
                <BlockList
                  blocks={block.children}
                  scope="section"
                  sectionId={block.id}
                  openId={openId}
                  picker={picker}
                  issues={issues}
                  handles={handles}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      <InsertSlot
        sectionId={sectionId}
        index={blocks.length}
        scope={scope}
        picking={sameInsertAt(picker, { sectionId, index: blocks.length })}
        handles={handles}
      />
    </div>
  );
}

/**
 * The „+" between two blocks. Always visible (a hover-only affordance is
 * invisible on a touch screen) but quiet: a hairline with a small plus, which
 * turns into the type picker in place.
 *
 * Memoized like the cards, and for the same reason: a scene has one slot more
 * than it has blocks, and none of them changes while the DM types. Exported
 * only so the re-render test can see the memo boundary.
 */
export const InsertSlot = memo(function InsertSlot({
  sectionId,
  index,
  scope,
  picking,
  handles,
}: {
  /** The list this slot inserts into; undefined = the document itself. */
  sectionId: string | undefined;
  index: number;
  scope: BlockScope;
  /** Is the type picker open at THIS slot? */
  picking: boolean;
  handles: Handles;
}) {
  const at: InsertAt = { sectionId, index };
  if (picking) {
    return (
      <div className="py-1.5">
        <BlockTypePicker
          scope={scope}
          onPick={(block) => handles.insert(at, block)}
          onCancel={() => handles.openPicker(undefined)}
        />
      </div>
    );
  }
  const where = at.sectionId === undefined ? "" : " im Falls-Abschnitt";
  return (
    <button
      type="button"
      aria-label={`Block${where} an Position ${at.index + 1} einfügen`}
      onClick={() => handles.openPicker(at)}
      className="group flex w-full items-center gap-2 py-1.5 text-faint transition-colors hover:text-primary"
    >
      <span aria-hidden className="h-px flex-1 bg-border group-hover:bg-input" />
      <Plus aria-hidden size={14} />
      <span aria-hidden className="h-px flex-1 bg-border group-hover:bg-input" />
    </button>
  );
});

/**
 * One block: label, two lines of content or its form, and its four controls.
 *
 * MEMOIZED, and its props are chosen for it: the block itself (a keystroke
 * replaces exactly one block object, every sibling keeps its identity — see
 * lib/composer.ts), two booleans, one string and the stable `handles`. So the
 * DM typing in one open card reconciles that card, not the whole scene. The
 * section's children are rendered by BlockList around this card, not inside it.
 *
 * Exported only so the re-render test can see the memo boundary.
 */
export const BlockCard = memo(function BlockCard({
  block,
  scope,
  index,
  total,
  open,
  issue,
  handles,
}: {
  block: SceneBlock;
  scope: BlockScope;
  index: number;
  total: number;
  /** Is this card's form expanded? */
  open: boolean;
  /** What blocks a save in THIS block (composerIssues), in German. */
  issue?: string;
  handles: Handles;
}) {
  const label = blockLabel(block);
  // „Vorlesetext 2" — the position makes the label of the second Vorlesetext in
  // a scene distinguishable for screen readers and for the E2E suite.
  const name = `${label} ${index + 1}`;

  return (
    <>
      {/* Label and controls share ONE line; the content gets the full card
          width below it. At 390px — and doubly so for a section's indented
          children — a form next to four buttons is a 110px input. */}
      <div className="flex items-center gap-2 px-2.5 pt-2 md:px-3">
        <p className="min-w-0 truncate text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          {label}
          {block.type === "raw" && block.calloutKind !== undefined && (
            <span className="ml-1.5 font-mono text-[10.5px] tracking-normal normal-case text-faint">
              [!{block.calloutKind}]
            </span>
          )}
        </p>
        <div className="ml-auto flex flex-none items-center">
          <Button
            type="button"
            variant="ghost"
            aria-label={`${name} nach oben`}
            disabled={index === 0}
            onClick={() => handles.move(block.id, -1)}
            className={ICON_BUTTON_CLASS}
          >
            <ChevronUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`${name} nach unten`}
            disabled={index === total - 1}
            onClick={() => handles.move(block.id, 1)}
            className={ICON_BUTTON_CLASS}
          >
            <ChevronDown aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={open ? `${name} zuklappen` : `${name} bearbeiten`}
            aria-expanded={open}
            onClick={() => handles.toggleOpen(block.id)}
            className={cn(ICON_BUTTON_CLASS, open && "text-primary")}
          >
            {open ? <ChevronUp aria-hidden /> : <PenLine aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`${name} löschen`}
            onClick={() => handles.remove(block.id)}
            className={cn(ICON_BUTTON_CLASS, "hover:bg-transparent hover:text-destructive")}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <div className="px-2.5 pb-2 md:px-3">
        {open ? (
          <BlockFields
            block={block}
            scope={scope}
            idPrefix={handles.idPrefix}
            onText={(text) => handles.setText(block.id, text)}
            onDepth={(depth) => handles.setDepth(block.id, depth)}
          />
        ) : (
          <BlockSummary block={block} />
        )}
        {/* What a save would break, at the block that carries it. The text is
            never corrected away — a `##` may be exactly what was meant, so the
            hint offers the two ways out and „Speichern" waits. */}
        {issue !== undefined && (
          <p aria-live="polite" className="mt-1 text-[11.5px] text-destructive">
            {issue}
          </p>
        )}
      </div>
    </>
  );
});

/**
 * What a collapsed card shows: the first two lines of the block's own text —
 * plain, not rendered. The composer is a structure view; the rendered document
 * lives one click away in „Roh" → „Vorschau" and, after saving, in the reading
 * view itself.
 */
function BlockSummary({ block }: { block: SceneBlock }) {
  const text = blockText(block).trim();
  if (text === "") {
    return <p className="mt-0.5 text-[13px] text-faint italic">leer</p>;
  }
  return (
    <p
      className={cn(
        "mt-0.5 line-clamp-2 text-[13px] leading-[1.5] break-words whitespace-pre-line",
        block.type === "ifSection" ? "text-body-secondary italic" : "text-body-secondary",
        block.type === "raw" && "font-mono text-[12px]",
      )}
    >
      {text}
    </p>
  );
}
