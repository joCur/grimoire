// The scenes of one chapter in the chapter overview: ONE list in the order the
// DM arranged (ADR #27), shown as two blocks — the plan, and the contingencies
// at the end — with up/down on every row and the create action underneath.
// The chapter is the tree's node; the scene order is written through its own
// endpoint with its own guard (lib/use-scene-order.ts).

import type { ChapterNode } from "@grimoire/shared/types";
import { GitFork } from "lucide-react";

import { useT } from "@/i18n";
import { contingencyScenes, plannedScenes } from "@/lib/scene-order";
import { useSceneOrderWrite } from "@/lib/use-scene-order";

import { SceneCreateAction } from "./SceneCreateAction";
import { SceneRow } from "./SceneRow";

export function SceneOrderList({ campaign, chapter }: { campaign: string; chapter: ChapterNode }) {
  const t = useT();
  const scenes = chapter.scenes;
  const planned = plannedScenes(scenes);
  const contingencies = contingencyScenes(scenes);
  const order = useSceneOrderWrite(campaign, chapter);

  return (
    <>
      {scenes.length === 0 && (
        <p className="pt-0.5 pb-3 text-[13.5px] text-muted-foreground">
          {t("chapterOverview.chapter.empty")}
        </p>
      )}
      {/* No heading over the plan: it IS the chapter's list, and the one
          thing a heading could still name — the location — stands in the meta
          line of the scene it belongs to. */}
      {planned.length > 0 && (
        <div className="mb-7">
          {planned.map((scene, index) => (
            <SceneRow
              key={scene.id}
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
          {/* Moved WITHIN this block: the ends of the block are the ends of
              the move, so the last planned scene and the first contingency
              never trade places for a press that then looks like nothing
              happened. */}
          {contingencies.map((scene, index) => (
            <SceneRow
              key={scene.id}
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
      {/* The create action sits IN the chapter, which is what prefills the
          chapter — no picker, no second decision. */}
      <div className="pb-4">
        <SceneCreateAction
          campaign={campaign}
          chapter={chapter.id}
          variant={scenes.length === 0 ? "primary" : "quiet"}
        />
      </div>
    </>
  );
}
