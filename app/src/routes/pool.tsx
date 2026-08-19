// "/:campaign" — scene pool. Placeholder view: a plain list so the file
// route is reachable; the real pool design lands later.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { fetchTree } from "@/api";

export function PoolRoute() {
  const { campaign = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">{campaign}</h1>
      {isPending && <p className="text-muted-foreground">Lade Szenen …</p>}
      {isError && (
        <p className="text-muted-foreground">
          Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.
        </p>
      )}
      {data &&
        data.chapters.map((chapter) => (
          <section key={chapter.id} className="space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {chapter.title}
            </h2>
            <ul className="space-y-1">
              {chapter.groups.flatMap((group) =>
                group.scenes.map((scene) => (
                  <li key={scene.path}>
                    <Link
                      className="text-primary underline underline-offset-2"
                      to={`/${campaign}/file/${scene.path}`}
                    >
                      {scene.title}
                    </Link>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{scene.status}</span>
                  </li>
                )),
              )}
            </ul>
          </section>
        ))}
    </section>
  );
}
