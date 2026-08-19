// "/:campaign/file/*" — single file view. Placeholder around the markdown
// pipeline; the real scene layout (frontmatter header, NPC cards) lands
// with the design delivery.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { fetchFile } from "@/api";
import { Markdown } from "@/markdown/Markdown";

export function SceneRoute() {
  const params = useParams();
  const campaign = params.campaign ?? "";
  const path = params["*"] ?? "";
  const { data, isPending, isError } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    enabled: campaign !== "" && path !== "",
  });

  const title =
    data && typeof data.frontmatter["title"] === "string" ? data.frontmatter["title"] : path;

  return (
    <article className="space-y-4">
      {isPending && <p className="text-muted-foreground">Lade Datei …</p>}
      {isError && (
        <p className="text-muted-foreground">
          Datei nicht ladbar — Pfad prüfen oder Server starten.
        </p>
      )}
      {data && (
        <>
          <header>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="font-mono text-xs text-muted-foreground">{data.path}</p>
          </header>
          <Markdown>{data.body}</Markdown>
        </>
      )}
    </article>
  );
}
