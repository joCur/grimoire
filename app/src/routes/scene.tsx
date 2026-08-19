// "/:campaign/file/*" — the scene reading view per the design reference:
// the scene article (type overline, Literata title, trigger row, chip row,
// markdown body — shared with the live view via SceneArticle) and a sticky
// right aside with the scene's NPC cards.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { fetchFile, fetchTree } from "@/api";
import { NpcCard } from "@/components/NpcCard";
import { SceneArticle } from "@/components/SceneArticle";
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

  const npcs = fmStringArray(data.frontmatter.npcs);

  return (
    <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-7 pt-10 pb-[100px] lg:flex-row">
      <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
        <SceneArticle file={data} tree={tree.data} variant="scene" />
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
  );
}
