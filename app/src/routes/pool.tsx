// "/:campaign" — the scene pool per the design reference: campaign header,
// chapter accordions with goal line, location-grouped planned scenes and a
// separate contingency group ("Eventualszenen").
// Below md the SAME route shows the mobile start surface instead (issue #11,
// responsive swap — no separate URL): desktop pool `hidden md:block`, mobile
// start `md:hidden`. Both share the tree query cache, so nothing fetches twice.

import type { CampaignTree, ChapterNode, SceneGroup, SceneSummary } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronDown, GitFork, MapPin } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { fetchEntry, fetchTree } from "@/api";
import { CampaignMetaAction } from "@/components/CampaignMetaAction";
import { ChapterActions } from "@/components/ChapterActions";
import { ChapterStatusControl } from "@/components/ChapterStatusMenu";
import { ChapterCreateAction, SceneCreateAction } from "@/components/CreateActions";
import { SceneStatusControl } from "@/components/SceneStatusMenu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useT } from "@/i18n";
import { locationName } from "@/lib/campaign";
import { firstParagraphOfSection } from "@/lib/md-section";
import { POOL_LOOKUP_TARGETS } from "@/lib/lookup";
import { useCampaignMeta } from "@/lib/use-campaign";
import { MobileStart } from "@/routes/mobile-start";

export function PoolRoute() {
  const t = useT();
  const { campaign = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  const sceneCount =
    data?.chapters.reduce(
      (n, ch) => n + ch.groups.reduce((m, g) => m + g.scenes.length, 0),
      0,
    ) ?? 0;
  const chapterCount = data?.chapters.length ?? 0;
  // Display name + description from campaign (issue #17); the header
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
        {isPending && <p className="text-muted-foreground">{t("pool.loading")}</p>}
        {isError && <p className="text-muted-foreground">{t("common.serverDown")}</p>}
        {data && (
          <>
            <div className="mb-5">
              {/* ONE row: title and counter left, the actions hard right on
                  the same line — the shape of the design reference's pool
                  header (design/Grimoire.dc.html: a baseline row that does
                  not wrap).
                  Issue #56 added „Kapitel anlegen" next to „Bearbeiten"
                  inside a `flex-wrap` row, and the pair promptly dropped onto
                  a line of ITS OWN, right-aligned under the title, on any
                  campaign with a normal-length name (PO finding on PR #87).
                  So the actions are no longer a wrap candidate: the row holds
                  the title block and the actions and does not wrap between
                  them. What gives when 760px is not enough for all of it is
                  the COUNTER, which drops under the title — it is the one
                  part of this header that is pure decoration, and dropping it
                  a line costs nothing, where truncating the campaign's name
                  or moving its actions costs the thing the header is FOR.
                  Below md the pool is not on screen at all (the mobile start
                  surface is), but the column stays the fallback so a narrow
                  viewport stacks LEFT-aligned instead of overflowing. */}
              <div className="flex flex-col items-start gap-1.5 md:flex-row md:flex-nowrap md:items-baseline md:gap-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="font-serif text-[28px] leading-[1.25] font-semibold text-foreground">
                    {meta.label}
                  </h1>
                  <span className="text-[13px] text-muted-foreground">
                    {t("pool.chapterCount", { count: chapterCount })} ·{" "}
                    {t("pool.sceneCount", { count: sceneCount })}
                  </span>
                </div>
                {/* Quiet header actions: add the thing the pool IS a list of
                    (issue #56), and edit the name/description right where they
                    are read (issue #34). */}
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
            {/* The empty pool is the second half of the cold start (issue
                #56): it used to point at the generator, which needs an API key
                and source material — a dead end on a fresh instance. The next
                step is now the one thing that always works. */}
            {data.chapters.length === 0 && (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-input bg-card px-5 py-4">
                <p className="text-[13.5px] leading-[1.6] text-body-secondary">
                  {t("pool.empty")}
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
  const scenes = chapter.groups.flatMap((g) => g.scenes);
  const contingencies = scenes.filter((s) => s.type === "contingency");

  // The chapter goal lives in the chapter entry body — fetched lazily on
  // first expand; missing entry/heading degrades to no goal line.
  const chapterFile = useQuery({
    queryKey: ["entry", campaign, chapter.path],
    queryFn: () => fetchEntry(campaign, chapter.path as string),
    enabled: open && chapter.path !== undefined,
    retry: false,
  });
  const goal = chapterFile.data
    ? firstParagraphOfSection(chapterFile.data.body, "Ziel des Kapitels")
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
              it the outline jumped from the pool's h1 straight to the group
              h3s, and the chapter the groups belong to was not in the tree at
              all (issue #100 review). */}
          <h2 className="min-w-0 truncate font-serif text-[18px] font-semibold text-foreground">
            {chapter.title}
          </h2>
          <span className="flex-1" />
          <span className="flex-none text-[12.5px] text-muted-foreground">
            {t("pool.sceneCount", { count: scenes.length })}
          </span>
        </CollapsibleTrigger>
        {/* The status that only SAID „Aktiv" is the control now: „Aktiv" swaps
            the active chapter in one server call, the other two patch this
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
            entry={chapterFile.data}
            tree={tree}
          />
          {goal !== undefined && (
            <p className="mb-3 text-[14px] leading-[1.6] text-body-secondary">
              {t("pool.chapter.goal", { goal })}
            </p>
          )}
          {scenes.length === 0 && (
            <p className="pt-0.5 pb-3 text-[13.5px] text-muted-foreground">
              {t("pool.chapter.empty")}
            </p>
          )}
          {chapter.groups.map((group) => (
            <PlannedGroup key={group.slug} campaign={campaign} group={group} tree={tree} />
          ))}
          {contingencies.length > 0 && (
            <div>
              <div className="flex items-center gap-2 border-b border-border py-2 text-[13px]">
                <GitFork aria-hidden size={15} className="flex-none text-muted-foreground" />
                {/* A section of the chapter, like a location group — and the
                    same level as one. */}
                <h3 className="font-medium text-soft">{t("scene.contingencies.heading")}</h3>
                <span className="text-muted-foreground">· {t("pool.contingencies.hint")}</span>
              </div>
              {contingencies.map((scene) => (
                <SceneRow key={scene.path} campaign={campaign} scene={scene} tree={tree} />
              ))}
            </div>
          )}
          {/* „Szene anlegen" sits IN the chapter, which is what prefills the
              chapter (issue #56) — no picker, no second decision. */}
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

/** One location group with its planned scenes (contingencies render separately). */
/** Exported for the render test — the „Ohne Ort" heading rule (#100). */
export function PlannedGroup({
  campaign,
  group,
  tree,
}: {
  campaign: string;
  group: SceneGroup;
  tree: CampaignTree;
}) {
  const t = useT();
  const planned = group.scenes.filter((s) => s.type !== "contingency");
  if (planned.length === 0) return null;
  return (
    <div className="mb-7">
      <div className="flex items-center gap-2 border-b border-border py-2 text-[13px]">
        <MapPin aria-hidden size={15} className="flex-none text-muted-foreground" />
        {/* The group IS the scene's location (issue #100), so the heading is
            the location's NAME — resolved by the SERVER, which also orders
            the groups by it (`SceneGroup.name`): an entry nobody has named
            yet falls back to its id, which is still the word the DM typed.
            "" is the group of the scenes that name no location at all: a
            neutral section, not a location with an empty name. */}
        {/* A real heading: it names a section of the chapter, and the
            accessibility tree (and the E2E suite) should be able to say so. */}
        <h3 className="font-medium text-soft">
          {group.slug === ""
            ? t("pool.group.noLocation")
            : group.name === ""
              ? group.slug
              : group.name}
        </h3>
      </div>
      {planned.map((scene) => (
        <SceneRow key={scene.path} campaign={campaign} scene={scene} tree={tree} />
      ))}
    </div>
  );
}

/**
 * One pool row. The row opens the scene — except the status area, which is
 * its own control since issue #28 (same menu as the reading view). The link
 * therefore covers everything but that control instead of wrapping it: a
 * button inside an anchor is invalid markup and would need click juggling,
 * two siblings in one hover row need neither.
 */
function SceneRow({
  campaign,
  scene,
  tree,
}: {
  campaign: string;
  scene: SceneSummary;
  tree: CampaignTree;
}) {
  const t = useT();
  const isContingency = scene.type === "contingency";
  const meta = [locationName(tree, scene.location), scene.tags.map((t) => `#${t}`).join(" ")]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <div className="group flex items-center gap-3 rounded-md border-b border-divider px-2.5 hover:bg-card">
      <Link
        to={`/${campaign}/entry/${scene.path}`}
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
              {t("pool.scene.trigger", { trigger: scene.trigger })}
            </span>
          ) : meta !== "" ? (
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{meta}</span>
          ) : null}
        </span>
      </Link>
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

/**
 * „Nachschlagen: NPCs · Orte · Glossar · Kampagnenwissen" — the pool's quiet
 * line into the campaign's reference pages (issue #53, PO feedback on PR #87).
 *
 * The mobile start surface has carried these as tap rows since issue #11; the
 * desktop had nowhere for the two new pages to be reached from. The TOPBAR is
 * deliberately not it — it keeps the three campaign-wide entries of issue #34
 * and does not grow (a fourth and fifth link there would crowd the one bar
 * that has to survive every width, and „Glossar" is not something the DM
 * reaches for mid-session). So the pool's own header gets the line, one row
 * under the campaign description: the same list as on the phone, in the
 * compact shape a desktop header can afford.
 *
 * The scene list is left out: the pool IS the scene list (lib/lookup.ts).
 */
function LookupLine({ campaign }: { campaign: string }) {
  const t = useT();
  return (
    <nav
      aria-label={t("lookup.heading")}
      className="mt-2.5 flex flex-wrap items-center gap-1 text-[12.5px] text-faint"
    >
      <span className="mr-0.5">{t("lookup.heading")}</span>
      {POOL_LOOKUP_TARGETS.map((target, index) => (
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
