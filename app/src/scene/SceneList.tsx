// The scenes of a campaign as a list page's rows, read from the campaign tree:
// flat per chapter, the chapter title as a quiet group overline, each row its
// title, the location's name and a link to its reading view.

import type { CampaignTree } from "@grimoire/shared/types";
import { Bookmark, GitFork } from "lucide-react";

import { ListRow } from "@/components/ListRow";
import { useT } from "@/i18n";
import { locationName } from "@/lib/campaign";

import { sceneHref } from "./scene-links";

export function SceneList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  const t = useT();
  const chapters = tree.chapters.filter((chapter) => chapter.scenes.length > 0);
  if (chapters.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("browse.empty.scenes")}</p>;
  }
  return (
    <>
      {chapters.map((chapter) => (
        <section key={chapter.id} className="mb-6">
          <p className="mb-1 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            {chapter.title}
          </p>
          {chapter.scenes.map((scene) => (
            <ListRow
              key={scene.id}
              to={sceneHref(campaign, scene.id)}
              icon={scene.type === "contingency" ? GitFork : Bookmark}
              title={scene.title}
              meta={locationName(tree, scene.location)}
            />
          ))}
        </section>
      ))}
    </>
  );
}
