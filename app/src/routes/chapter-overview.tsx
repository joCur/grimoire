// "/campaigns/:campaign" — the chapter overview per the design reference: campaign header,
// chapter accordions with goal line, the chapter's planned scenes as ONE
// list in the order the DM arranged (ADR #27) and a separate contingency
// group at the end.
// Below md the SAME route shows the mobile start surface instead — a
// responsive swap, no separate URL: the desktop chapter overview is
// `hidden md:block`, the mobile start `md:hidden`. Both share the tree query
// cache, so nothing fetches twice.

import type { CampaignTree, ChapterNode, SceneSummary } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Bookmark, ChevronDown, GitFork } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { fetchEntry, fetchTree } from "@/api";
import { CampaignMetaAction } from "@/components/CampaignMetaAction";
import { ChapterActions } from "@/components/ChapterActions";
import { ChapterStatusControl } from "@/components/ChapterStatusMenu";
import { ChapterCreateAction, SceneCreateAction } from "@/components/CreateActions";
import { SceneStatusControl } from "@/components/SceneStatusMenu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useT } from "@/i18n";
import { firstParagraphOfSection } from "@/lib/md-section";
import { CHAPTER_OVERVIEW_LOOKUP_TARGETS } from "@/lib/lookup";
import { contingencyScenes, plannedScenes } from "@/lib/scene-order";
import { useCampaignMeta } from "@/lib/use-campaign";
import { useSceneOrderWrite } from "@/lib/use-scene-order";
import { MobileStart } from "@/routes/mobile-start";

export function ChapterOverviewRoute() {
  const t = useT();
  const { campaign = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  const sceneCount = data?.chapters.reduce((n, ch) => n + ch.scenes.length, 0) ?? 0;
  const chapterCount = data?.chapters.length ?? 0;
  // Display name + description from campaign; the header
  // degrades to the campaign id when the entry is missing.
  const meta = useCampaignMeta(campaign);
  // Open the active chapter(s) by default; without one, the first.
  const anyActive = data?.chapters.some((ch) => ch.status === "active") ?? false;

  return (
    <>
      <div className="md:hidden">
        <MobileStart campaign={campaign} />
      </div>
      <div className="mx-auto hidden max-w-[760px] px-7 pt-10 pb-20 md:block">
        {isPending && <p className="text-muted-foreground">{t("chapterOverview.loading")}</p>}
        {isError && <p className="text-muted-foreground">{t("common.serverDown")}</p>}
        {data && (
          <>
            <div className="mb-5">
              {/* ONE row: title and counter left, the actions hard right on
                  the same line — the shape of the design reference's chapter overview
                  header (design/Grimoire.dc.html: a baseline row that does
                  not wrap).
                  „Kapitel anlegen" was added next to „Bearbeiten"
                  inside a `flex-wrap` row, and the pair promptly dropped onto
                  a line of ITS OWN, right-aligned under the title, on any
                  campaign with a normal-length name (PO finding).
                  So the actions are no longer a wrap candidate: the row holds
                  the title block and the actions and does not wrap between
                  them. What gives when 760px is not enough for all of it is
                  the COUNTER, which drops under the title — it is the one
                  part of this header that is pure decoration, and dropping it
                  a line costs nothing, where truncating the campaign's name
                  or moving its actions costs the thing the header is FOR.
                  Below md the chapter overview is not on screen at all (the mobile start
                  surface is), but the column stays the fallback so a narrow
                  viewport stacks LEFT-aligned instead of overflowing. */}
              <div className="flex flex-col items-start gap-1.5 md:flex-row md:flex-nowrap md:items-baseline md:gap-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="font-serif text-[28px] leading-[1.25] font-semibold text-foreground">
                    {meta.label}
                  </h1>
                  <span className="text-[13px] text-muted-foreground">
                    {t("chapterOverview.chapterCount", { count: chapterCount })} ·{" "}
                    {t("chapterOverview.sceneCount", { count: sceneCount })}
                  </span>
                </div>
                {/* Quiet header actions: add the thing the chapter overview
                    IS a list of, and edit the name/description right where
                    they are read. */}
                <span className="flex flex-none items-center gap-1 md:ml-auto">
                  <ChapterCreateAction campaign={campaign} />
                  <CampaignMetaAction campaign={campaign} />
                </span>
              </div>
              {meta.description !== undefined && (
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-[1.55] text-body-secondary">
                  {meta.description}
                </p>
              )}
              <LookupLine campaign={campaign} />
            </div>
            {/* The empty chapter overview is the second half of the cold start: it used
                to point at the generator, which needs an API key
                and source material — a dead end on a fresh instance. The next
                step is now the one thing that always works. */}
            {data.chapters.length === 0 && (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-input bg-card px-5 py-4">
                <p className="text-[13.5px] leading-[1.6] text-body-secondary">
                  {t("chapterOverview.empty")}
                </p>
                <ChapterCreateAction campaign={campaign} variant="primary" />
              </div>
            )}
            {data.chapters.map((chapter, index) => (
              <Chapter
                key={chapter.id}
                campaign={campaign}
                chapter={chapter}
                tree={data}
                defaultOpen={anyActive ? chapter.status === "active" : index === 0}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function Chapter({
  campaign,
  chapter,
  tree,
  defaultOpen,
}: {
  campaign: string;
  chapter: ChapterNode;
  tree: CampaignTree;
  defaultOpen: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  // ONE list in the order the DM arranged, shown as two blocks: the plan, and
  // the contingencies at the end. `pos` runs over both (ADR #27).
  const scenes = chapter.scenes;
  const planned = plannedScenes(scenes);
  const contingencies = contingencyScenes(scenes);
  const order = useSceneOrderWrite(campaign, chapter);

  // The chapter goal lives in the chapter entry body — fetched lazily on
  // first expand; missing entry/heading degrades to no goal line.
  const chapterEntry = useQuery({
    queryKey: ["entry", campaign, chapter.path],
    queryFn: () => fetchEntry(campaign, chapter.path as string),
    enabled: open && chapter.path !== undefined,
    retry: false,
  });
  const goal = chapterEntry.data
    ? firstParagraphOfSection(chapterEntry.data.body, "Ziel des Kapitels")
    : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-4">
      {/* ONE row, but not one button: the status control is a menu trigger,
          and a button inside a button is invalid markup. So the trigger covers
          the chevron, the heading and the scene count — the whole reading of
          the row — and the control sits BESIDE it in the same flex line with
          the shared bottom border. */}
      <div className="flex w-full items-center gap-2.5 border-b border-border pt-2.5 pb-3">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDown
            aria-hidden
            size={15}
            className="flex-none -rotate-90 text-muted-foreground transition-transform group-data-[state=open]:rotate-0"
          />
          {/* The chapter names a section of the page, so it IS a heading —
              inside the trigger, which stays the button that opens it. Without
              it the outline jumped from the chapter overview's h1 straight to the group
              h3s, and the chapter the groups belong to was not in the tree at
              all. */}
          <h2 className="min-w-0 truncate font-serif text-[18px] font-semibold text-foreground">
            {chapter.title}
          </h2>
          <span className="flex-1" />
          <span className="flex-none text-[12.5px] text-muted-foreground">
            {t("chapterOverview.sceneCount", { count: scenes.length })}
          </span>
        </CollapsibleTrigger>
        {/* The status is the control: picking the active status swaps the
            active chapter in one server call, the other two patch this
            chapter. Mobile never sees it — the route renders the start
            surface instead of the overview below md. */}
        <ChapterStatusControl campaign={campaign} chapter={chapter.id} status={chapter.status} />
      </div>
      <CollapsibleContent>
        <div className="pt-4 pb-1 pl-[25px]">
          {/* The chapter's own actions. They sit INSIDE the accordion and not
              in the heading row: that row is already as wide as it gets, and
              the actions are for the chapter the DM has opened. */}
          <ChapterActions
            campaign={campaign}
            chapter={chapter.id}
            entry={chapterEntry.data}
            tree={tree}
          />
          {goal !== undefined && (
            <p className="mb-3 text-[14px] leading-[1.6] text-body-secondary">
              {t("chapterOverview.chapter.goal", { goal })}
            </p>
          )}
          {scenes.length === 0 && (
            <p className="pt-0.5 pb-3 text-[13.5px] text-muted-foreground">
              {t("chapterOverview.chapter.empty")}
            </p>
          )}
          {/* No heading over the plan: it IS the chapter's list, and the one
              thing a heading could still name — the location — now stands in
              the meta line of the scene it belongs to. */}
          {planned.length > 0 && (
            <div className="mb-7">
              {planned.map((scene, index) => (
                <SceneRow
                  key={scene.path}
                  campaign={campaign}
                  scene={scene}
                  first={index === 0}
                  last={index === planned.length - 1}
                  busy={order.isPending}
                  onMove={(delta) => order.move(scene.id, delta)}
                />
              ))}
            </div>
          )}
          {contingencies.length > 0 && (
            <div>
              <div className="flex items-center gap-2 border-b border-border py-2 text-[13px]">
                <GitFork aria-hidden size={15} className="flex-none text-muted-foreground" />
                {/* A real heading: it names a section of the chapter, and the
                    accessibility tree should be able to say so. */}
                <h3 className="font-medium text-soft">{t("scene.contingencies.heading")}</h3>
                <span className="text-muted-foreground">· {t("chapterOverview.contingencies.hint")}</span>
              </div>
              {/* Moved WITHIN this block: the ends of the block are the ends
                  of the move, so the last planned scene and the first
                  contingency never trade places for a press that then looks
                  like nothing happened. */}
              {contingencies.map((scene, index) => (
                <SceneRow
                  key={scene.path}
                  campaign={campaign}
                  scene={scene}
                  first={index === 0}
                  last={index === contingencies.length - 1}
                  busy={order.isPending}
                  onMove={(delta) => order.move(scene.id, delta)}
                />
              ))}
            </div>
          )}
          {/* One quiet line at the list, never a toast — the DM is looking
              straight at the rows they just moved. */}
          {order.message !== undefined && (
            <p role="status" className="pt-2.5 text-[12.5px] text-destructive">
              {order.message}
            </p>
          )}
          {/* The scene create action sits IN the chapter, which is what
              prefills the chapter — no picker, no second decision. */}
          <div className="pb-4">
            <SceneCreateAction
              campaign={campaign}
              chapter={chapter.id}
              variant={scenes.length === 0 ? "primary" : "quiet"}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One chapter overview row. The row opens the scene — except the status area, which is
 * its own control (same menu as the reading view). The link
 * therefore covers everything but that control instead of wrapping it: a
 * button inside an anchor is invalid markup and would need click juggling,
 * two siblings in one hover row need neither.
 *
 * Exported for the render test: the meta line and the two move controls.
 */
export function SceneRow({
  campaign,
  scene,
  first,
  last,
  busy,
  onMove,
}: {
  campaign: string;
  scene: SceneSummary;
  /** Ends of the DISPLAYED block — where the move has nowhere to go. */
  first: boolean;
  last: boolean;
  /** A move of this chapter is on the wire; the rows hold still until it lands. */
  busy: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const t = useT();
  const isContingency = scene.type === "contingency";
  // The location is a word of the scene now, not a heading above it — the
  // NAME the server resolved, degraded to the id it could not resolve. A
  // scene without one simply has no location part: no placeholder, no dangling
  // separator (ADR #27).
  const meta = [scene.locationName ?? scene.location, scene.tags.map((tag) => `#${tag}`).join(" ")]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <div className="group flex items-center gap-3 rounded-md border-b border-divider px-2.5 hover:bg-card">
      <Link
        to={`/campaigns/${campaign}/entries/${scene.path}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-[13px]"
      >
        {isContingency ? (
          <GitFork aria-hidden size={17} className="flex-none text-muted-foreground" />
        ) : (
          <Bookmark aria-hidden size={17} className="flex-none text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] text-foreground">{scene.title}</span>
          {isContingency && scene.trigger !== undefined ? (
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground italic">
              {t("chapterOverview.scene.trigger", { trigger: scene.trigger })}
            </span>
          ) : meta !== "" ? (
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{meta}</span>
          ) : null}
        </span>
      </Link>
      {/* Quiet until the row is the one in hand (UI-BRIEF §1): the pair fades
          in on hover and on keyboard focus, and it is never a standing label
          next to every scene. Opacity only — the buttons stay in the tab order
          and keep their accessible names either way. */}
      <span className="flex flex-none items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
        <MoveButton
          label={t("chapterOverview.scene.moveUp.aria", { title: scene.title })}
          disabled={first || busy}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden />
        </MoveButton>
        <MoveButton
          label={t("chapterOverview.scene.moveDown.aria", { title: scene.title })}
          disabled={last || busy}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden />
        </MoveButton>
      </span>
      {/* No rev in the tree — the control fetches the entry when it opens. */}
      <SceneStatusControl
        campaign={campaign}
        path={scene.path}
        status={scene.status}
        variant="row"
      />
    </div>
  );
}

/** Icon-only up/down control of a row — named for screen readers by its scene. */
function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}

/**
 * The chapter overview's quiet lookup line into the campaign's reference
 * pages (NPCs, locations, glossary, campaign knowledge).
 *
 * The mobile start surface carries these as tap rows; the desktop has nowhere
 * else for the glossary and the knowledge page to be reached from. The TOPBAR
 * is deliberately not it — it keeps the three campaign-wide entries and does
 * not grow (a fourth and fifth link there would crowd the one bar that has to
 * survive every width, and the glossary is not something the DM reaches for
 * mid-session). So the chapter overview's own header gets the line, one row
 * under the campaign description: the same list as on the phone, in the
 * compact shape a desktop header can afford.
 *
 * The scene list is left out: the chapter overview IS the scene list (lib/lookup.ts).
 */
function LookupLine({ campaign }: { campaign: string }) {
  const t = useT();
  return (
    <nav
      aria-label={t("lookup.heading")}
      className="mt-2.5 flex flex-wrap items-center gap-1 text-[12.5px] text-faint"
    >
      <span className="mr-0.5">{t("lookup.heading")}</span>
      {CHAPTER_OVERVIEW_LOOKUP_TARGETS.map((target, index) => (
        <span key={target.id} className="flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="mr-0.5">
              ·
            </span>
          )}
          <Link
            to={target.href(campaign)}
            className="rounded px-0.5 text-body-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t(target.label)}
          </Link>
        </span>
      ))}
    </nav>
  );
}
