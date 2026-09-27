// "/campaigns/:campaign" — the campaign's route, the chapter overview per the
// design reference: the campaign header with the campaign's text, chapter
// accordions with the chapter's text and threads, the chapter's planned
// scenes as ONE list in the order the DM arranged (decisions/scene-order) and a separate
// contingency group at the end.
//
// The overview shows several entities, so it is composed from their slices,
// like the app's routes: the campaign's text and edit action, each chapter's
// accordion with its status control and actions, and the threads and the
// scene list handed into that accordion — no slice reaches into another.
//
// Below md the SAME route is the phone's start of the campaign: search and
// the idea capture above the chapter overview, the language switch below it
// (routes/mobile-start.tsx). The overview itself is one tree for every width,
// laid out for 390px as much as for the desktop column.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { fetchTree, isNotFound } from "@/api";
import { CampaignEditAction } from "@/campaign/CampaignEditAction";
import { campaignQuery } from "@/campaign/campaign-query";
import { ChapterCreateAction } from "@/chapter/ChapterCreateAction";
import { ChapterSection } from "@/chapter/ChapterSection";
import { ClampedText } from "@/components/ClampedText";
import { NotFound } from "@/components/NotFound";
import { useT } from "@/i18n";
import { useCampaignMeta } from "@/lib/use-campaign";
import { MobileStartBottom, MobileStartTop } from "@/routes/mobile-start";
import { SceneOrderList } from "@/scene/SceneOrderList";
import { ThreadList } from "@/thread/ThreadList";

export function ChapterOverviewRoute() {
  const t = useT();
  const { campaign = "" } = useParams();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  const sceneCount = data?.chapters.reduce((n, ch) => n + ch.scenes.length, 0) ?? 0;
  const chapterCount = data?.chapters.length ?? 0;
  // Display name + description from the campaign list; the header degrades
  // to the campaign id while the list does not know it.
  const meta = useCampaignMeta(campaign);
  // The campaign's TEXT stands under the description. The list does not carry
  // it, so it is read from the campaign itself — the same query the edit
  // dialog reads, so it is cached once.
  const campaignRead = useQuery({
    ...campaignQuery(campaign),
    enabled: campaign !== "",
    retry: false,
  });
  // Open the active chapter(s) by default; without one, the first.
  const anyActive = data?.chapters.some((ch) => ch.status === "active") ?? false;

  // A campaign the server does not know: the not-found view on both
  // breakpoints, and the way back is the start, not this campaign.
  if (data === undefined && isNotFound(error)) return <NotFound />;

  return (
    <>
      <MobileStartTop campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-8 pb-12 md:px-7 md:pt-10 md:pb-20">
        {isPending && <p className="text-muted-foreground">{t("chapterOverview.loading")}</p>}
        {isError && <p className="text-muted-foreground">{t("common.serverDown")}</p>}
        {data && (
          <>
            <div className="mb-5">
              {/* ONE row: title and counter left, the actions hard right on
                  the same line — the shape of the design reference's chapter overview
                  header (design/Grimoire.dc.html: a baseline row that does
                  not wrap).
                  In a `flex-wrap` row, the create-chapter action next to
                  the edit action drops onto a line of ITS OWN, right-aligned
                  under the title, on any campaign with a normal-length name.
                  So the actions are no longer a wrap candidate: the row holds
                  the title block and the actions and does not wrap between
                  them. What gives when 760px is not enough for all of it is
                  the COUNTER, which drops under the title — it is the one
                  part of this header that is pure decoration, and dropping it
                  a line costs nothing, where truncating the campaign's name
                  or moving its actions costs the thing the header is FOR.
                  Below md the row becomes a column, so the phone stacks the
                  header LEFT-aligned instead of overflowing. */}
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
                  <CampaignEditAction campaign={campaign} />
                </span>
              </div>
              {meta.description !== undefined && (
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-[1.55] text-body-secondary">
                  {meta.description}
                </p>
              )}
              {/* The whole text, a few lines of it at first — nothing is
                  picked out of it by a heading (decisions/data-shape). A campaign without
                  one shows nothing here. */}
              <ClampedText className="mt-2.5 max-w-[62ch]">
                {campaignRead.data?.body ?? ""}
              </ClampedText>
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
              <ChapterSection
                key={chapter.id}
                campaign={campaign}
                chapter={chapter}
                defaultOpen={anyActive ? chapter.status === "active" : index === 0}
                // The storylines the chapter carries, under its text — their
                // own list, read once the chapter is open.
                threads={<ThreadList campaign={campaign} chapter={chapter.id} enabled />}
                scenes={<SceneOrderList campaign={campaign} chapter={chapter} />}
              />
            ))}
          </>
        )}
      </div>
      <MobileStartBottom />
    </>
  );
}
