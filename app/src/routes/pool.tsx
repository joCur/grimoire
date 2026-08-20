// "/:campaign" — the scene pool per the design reference: campaign header,
// chapter accordions with goal line, location-grouped planned scenes and a
// separate contingency group ("Falls es schiefgeht").
// Below md the SAME route shows the mobile start surface instead (issue #11,
// responsive swap — no separate URL): desktop pool `hidden md:block`, mobile
// start `md:hidden`. Both share the tree query cache, so nothing fetches twice.

import type { CampaignTree, ChapterNode, SceneGroup, SceneSummary } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronDown, GitFork, MapPin } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { fetchFile, fetchTree } from "@/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { locationName } from "@/lib/campaign";
import { firstParagraphOfSection } from "@/lib/md-section";
import { useCampaignMeta } from "@/lib/use-campaign";
import { cn } from "@/lib/utils";
import { MobileStart } from "@/routes/mobile-start";

/** Scene status → German label + dot/text colors (unknown values pass through). */
function statusMeta(status: string): { label: string; dot: string; text: string } {
  switch (status) {
    case "ready":
      return { label: "bereit", dot: "bg-success", text: "text-success-text" };
    case "draft":
      return { label: "Entwurf", dot: "bg-muted-foreground", text: "text-dim" };
    case "played":
      return { label: "gespielt", dot: "bg-faint", text: "text-muted-foreground" };
    case "dropped":
      return { label: "verworfen", dot: "bg-faint", text: "text-muted-foreground" };
    default:
      return { label: status, dot: "bg-muted-foreground", text: "text-dim" };
  }
}

function sceneCountLabel(count: number): string {
  if (count === 0) return "keine Szenen";
  if (count === 1) return "1 Szene";
  return `${count} Szenen`;
}

export function PoolRoute() {
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
  // Display name + description from _campaign.md (issue #17); the header
  // degrades to the campaign id when the file is missing.
  const meta = useCampaignMeta(campaign);
  // Open the active chapter(s) by default; without one, the first.
  const anyActive = data?.chapters.some((ch) => ch.status === "active") ?? false;

  return (
    <>
      <div className="md:hidden">
        <MobileStart campaign={campaign} />
      </div>
      <div className="mx-auto hidden max-w-[760px] px-7 pt-10 pb-20 md:block">
        {isPending && <p className="text-muted-foreground">Lade Szenen …</p>}
        {isError && (
          <p className="text-muted-foreground">
            Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.
          </p>
        )}
        {data && (
          <>
            <div className="mb-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <h1 className="font-serif text-[28px] leading-[1.25] font-semibold text-foreground">
                  {meta.label}
                </h1>
                <span className="text-[13px] text-muted-foreground">
                  {chapterCount === 1 ? "1 Kapitel" : `${chapterCount} Kapitel`} ·{" "}
                  {sceneCountLabel(sceneCount)}
                </span>
              </div>
              {meta.description !== undefined && (
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-[1.55] text-body-secondary">
                  {meta.description}
                </p>
              )}
            </div>
            {data.chapters.length === 0 && (
              <p className="text-[13.5px] text-muted-foreground">
                Noch keine Kapitel — Kapitel-Ordner mit _chapter.md anlegen.
              </p>
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
  const [open, setOpen] = useState(defaultOpen);
  const scenes = chapter.groups.flatMap((g) => g.scenes);
  const contingencies = scenes.filter((s) => s.type === "contingency");

  // The chapter goal lives in the _chapter.md body — fetched lazily on
  // first expand; missing file/heading degrades to no goal line.
  const chapterFile = useQuery({
    queryKey: ["file", campaign, chapter.path],
    queryFn: () => fetchFile(campaign, chapter.path as string),
    enabled: open && chapter.path !== undefined,
    retry: false,
  });
  const goal = chapterFile.data
    ? firstParagraphOfSection(chapterFile.data.body, "Ziel des Kapitels")
    : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-4">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 border-b border-border pt-2.5 pb-3 text-left">
        <ChevronDown
          aria-hidden
          size={15}
          className="flex-none -rotate-90 text-muted-foreground transition-transform group-data-[state=open]:rotate-0"
        />
        <span className="font-serif text-[18px] font-semibold text-foreground">
          {chapter.title}
        </span>
        <ChapterStatusPill status={chapter.status} />
        <span className="flex-1" />
        <span className="flex-none text-[12.5px] text-muted-foreground">
          {sceneCountLabel(scenes.length)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-4 pb-1 pl-[25px]">
          {goal !== undefined && (
            <p className="mb-3 text-[14px] leading-[1.6] text-body-secondary">Ziel: {goal}</p>
          )}
          {scenes.length === 0 && (
            <p className="pt-0.5 pb-4 text-[13.5px] text-muted-foreground">
              Noch keine Szenen in diesem Kapitel — erste Szene anlegen.
            </p>
          )}
          {chapter.groups.map((group) => (
            <PlannedGroup key={group.slug} campaign={campaign} group={group} tree={tree} />
          ))}
          {contingencies.length > 0 && (
            <div>
              <div className="flex items-center gap-2 border-b border-border py-2 text-[13px]">
                <GitFork aria-hidden size={15} className="flex-none text-muted-foreground" />
                <span className="font-medium text-soft">Falls es schiefgeht</span>
                <span className="text-muted-foreground">· Kontingenzen</span>
              </div>
              {contingencies.map((scene) => (
                <SceneRow key={scene.path} campaign={campaign} scene={scene} tree={tree} />
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChapterStatusPill({ status }: { status?: string | undefined }) {
  if (status === undefined || status === "") return null;
  const active = status === "active";
  return (
    <span
      className={cn(
        "flex-none rounded-full border px-[9px] py-px text-[11.5px]",
        active
          ? "border-[color-mix(in_srgb,var(--success)_35%,transparent)] text-success-text"
          : "border-input text-dim",
      )}
    >
      {active ? "aktiv" : status}
    </span>
  );
}

/** One location group with its planned scenes (contingencies render separately). */
function PlannedGroup({
  campaign,
  group,
  tree,
}: {
  campaign: string;
  group: SceneGroup;
  tree: CampaignTree;
}) {
  const planned = group.scenes.filter((s) => s.type !== "contingency");
  if (planned.length === 0) return null;
  return (
    <div className="mb-7">
      {group.slug !== "" && (
        <div className="flex items-center gap-2 border-b border-border py-2 text-[13px]">
          <MapPin aria-hidden size={15} className="flex-none text-muted-foreground" />
          <span className="font-medium text-soft">{group.slug}</span>
        </div>
      )}
      {planned.map((scene) => (
        <SceneRow key={scene.path} campaign={campaign} scene={scene} tree={tree} />
      ))}
    </div>
  );
}

function SceneRow({
  campaign,
  scene,
  tree,
}: {
  campaign: string;
  scene: SceneSummary;
  tree: CampaignTree;
}) {
  const isContingency = scene.type === "contingency";
  const status = statusMeta(scene.status);
  const meta = [locationName(tree, scene.location), scene.tags.map((t) => `#${t}`).join(" ")]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <Link
      to={`/${campaign}/file/${scene.path}`}
      className="flex items-center gap-3 rounded-md border-b border-divider px-2.5 py-[13px] hover:bg-card"
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
            Wenn: {scene.trigger}
          </span>
        ) : meta !== "" ? (
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{meta}</span>
        ) : null}
      </span>
      <span className="flex flex-none items-center gap-1.5">
        <span aria-hidden className={cn("size-[7px] rounded-full", status.dot)} />
        <span className={cn("text-[12px]", status.text)}>{status.label}</span>
      </span>
    </Link>
  );
}
