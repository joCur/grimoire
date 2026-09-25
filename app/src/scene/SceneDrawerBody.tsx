// A scene in the live drawer: the same article its reading view shows, read
// through its own query, inside the shared drawer frame.

import { useQuery } from "@tanstack/react-query";

import { fetchTree } from "@/api";
import { DrawerFrame } from "@/components/DrawerFrame";

import { SceneArticle } from "./SceneArticle";
import { sceneHref } from "./scene-links";
import { sceneQuery } from "./scene-query";

export function SceneDrawerBody({ campaign, id }: { campaign: string; id: string }) {
  const { data, isPending, isError } = useQuery({ ...sceneQuery(campaign, id), retry: false });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  return (
    <DrawerFrame
      href={sceneHref(campaign, id)}
      shown={id}
      name={data === undefined || data.title === "" ? id : data.title}
      isPending={isPending}
      isError={isError}
    >
      {data !== undefined && <SceneArticle scene={data} tree={tree.data} variant="scene" />}
    </DrawerFrame>
  );
}
