// "/:campaign/file/*" — the scene reading view per the design reference:
// type overline, Literata title, trigger row (contingencies), chip row
// (location, tags, handouts), the markdown body through the pipeline, and
// a sticky right aside with the scene's NPC cards (voice, Will, quickstats
// — exactly those three, per UI-BRIEF).

import { useQuery } from "@tanstack/react-query";
import { Bookmark, GitFork, MapPin } from "lucide-react";
import { useParams } from "react-router";

import { fetchFile, fetchTree } from "@/api";
import { locationName } from "@/lib/campaign";
import { fmQuickstats, fmString, fmStringArray } from "@/lib/frontmatter";
import { firstParagraphOfSection } from "@/lib/md-section";
import { Markdown } from "@/markdown/Markdown";

export function SceneRoute() {
  const params = useParams();
  const campaign = params.campaign ?? "";
  const path = params["*"] ?? "";
  const enabled = campaign !== "" && path !== "";
  const { data, isPending, isError } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    enabled,
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  if (isPending) {
    return <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">Lade Datei …</p>;
  }
  if (isError || !data) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        Datei nicht ladbar — Pfad prüfen oder Server starten.
      </p>
    );
  }

  const fm = data.frontmatter;
  const title = fmString(fm.title) ?? path;
  // Everything that is not explicitly a contingency reads as a planned
  // scene (degrade — "planned" is the unmarked case).
  const isContingency = fmString(fm.type) === "contingency";
  const trigger = fmString(fm.trigger);
  const location = locationName(tree.data, fmString(fm.location));
  const tags = fmStringArray(fm.tags);
  const handouts = fmStringArray(fm.handouts);
  const npcs = fmStringArray(fm.npcs);

  return (
    <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-7 pt-10 pb-[100px] lg:flex-row">
      <article className="w-full min-w-0 flex-1 lg:max-w-[680px]">
        <div className="mb-2.5 flex items-center gap-2.5">
          {isContingency ? (
            <GitFork aria-hidden size={16} className="flex-none text-soft" />
          ) : (
            <Bookmark aria-hidden size={16} className="flex-none text-success-text" />
          )}
          <span
            className={
              isContingency
                ? "text-[12px] tracking-[.06em] uppercase text-soft"
                : "text-[12px] tracking-[.06em] uppercase text-success-text"
            }
          >
            {isContingency ? "Kontingenz" : "Geplante Szene"}
          </span>
        </div>
        <h1 className="mb-3.5 font-serif text-[30px] leading-[1.2] font-semibold text-foreground">
          {title}
        </h1>
        {isContingency && trigger !== undefined && (
          <div className="mb-3 flex items-baseline gap-2 text-[13.5px]">
            <span className="text-muted-foreground">Auslöser</span>
            <span className="text-soft italic">{trigger}</span>
          </div>
        )}
        {(location !== undefined || tags.length > 0 || handouts.length > 0) && (
          <div className="mb-7 flex flex-wrap items-center gap-2 border-b border-border pb-5">
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
            {handouts.map((handout) => (
              <span
                key={handout}
                className="rounded-full border border-dashed border-input px-3 py-1 text-[12.5px] text-body-secondary"
              >
                Handout: {handout}
              </span>
            ))}
          </div>
        )}
        <Markdown>{data.body}</Markdown>
      </article>
      {npcs.length > 0 && (
        <aside className="flex w-full flex-none flex-col gap-3.5 lg:sticky lg:top-0 lg:w-[280px]">
          <h2 className="text-[12px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            NPCs dieser Szene
          </h2>
          {npcs.map((id) => (
            <NpcCard key={id} campaign={campaign} id={id} />
          ))}
        </aside>
      )}
    </div>
  );
}

/** One NPC card; a missing/broken npcs/<id>.md skips the card silently. */
function NpcCard({ campaign, id }: { campaign: string; id: string }) {
  const { data, isError } = useQuery({
    queryKey: ["file", campaign, `npcs/${id}.md`],
    queryFn: () => fetchFile(campaign, `npcs/${id}.md`),
    retry: false,
  });
  if (isError || !data) return null;

  const fm = data.frontmatter;
  const name = fmString(fm.name) ?? id;
  const npcId = fmString(fm.id) ?? id;
  const role = fmString(fm.role);
  const voice = fmString(fm.voice);
  const will = firstParagraphOfSection(data.body, "Will");
  const quickstats = fmQuickstats(fm.quickstats);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-[2px] flex items-baseline gap-2">
        <span className="font-serif text-[16px] font-semibold text-foreground">{name}</span>
        <span className="font-mono text-[10.5px] text-faint">{npcId}</span>
      </div>
      {role !== undefined && <p className="mb-3 text-[12.5px] text-muted-foreground">{role}</p>}
      {voice !== undefined && (
        <>
          <p className="mb-[3px] text-[11px] tracking-[.06em] uppercase text-muted-foreground">
            Stimme
          </p>
          <p className="mb-2.5 text-[13px] leading-[1.5] text-body italic">{voice}</p>
        </>
      )}
      {will !== undefined && (
        <>
          <p className="mb-[3px] text-[11px] tracking-[.06em] uppercase text-muted-foreground">
            Will
          </p>
          <p className="mb-3 text-[13px] leading-[1.5] text-body">{will}</p>
        </>
      )}
      {quickstats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
    </div>
  );
}
