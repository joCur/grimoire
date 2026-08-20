// "/:campaign/file/*" — the reading view of ONE file. For a scene that is
// the scene article per the design reference (type overline, Literata title,
// trigger row, chip row, markdown body — shared with the live view via
// SceneArticle) plus a sticky right aside with the scene's NPC cards. Below
// md (issue #11): a "‹ Pool" back row on top and the NPC cards stacked below
// the body (the column layout already stacks under lg).
//
// Every other entity (issue #26) renders through EntityArticle, chosen by the
// `kind` the server sends: NPC, location, or a plain titled header for
// chapter/campaign/anything else. The scene's type overline belongs to scenes
// only — "Geplante Szene" above an NPC was the PO's pain report.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { fetchFile, fetchTree } from "@/api";
import { EntityArticle } from "@/components/EntityArticle";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCard } from "@/components/NpcCard";
import { SceneArticle } from "@/components/SceneArticle";
import { entityHeaderKind } from "@/lib/entity";
import { fmStringArray } from "@/lib/frontmatter";

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

  const isScene = entityHeaderKind(data.kind) === "scene";
  // The aside belongs to scenes: only they reference npcs in frontmatter.
  const npcs = isScene ? fmStringArray(data.frontmatter.npcs) : [];

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          {isScene ? (
            <SceneArticle file={data} tree={tree.data} variant="scene" />
          ) : (
            <EntityArticle file={data} />
          )}
        </div>
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
    </>
  );
}
