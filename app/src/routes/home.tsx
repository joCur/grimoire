// "/" — no page of its own (issue #14): it redirects into the last active
// campaign, so opening Grimoire lands directly where the DM left off. The
// heuristic is server-side data (`lastSession` per campaign, no localStorage
// — the server is the truth); the switcher in the topbar stays the only way
// to change campaigns. Only a campaign root without any campaign renders
// something here: a quiet empty state.

import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";

import { fetchCampaigns } from "@/api";
import { pickLastCampaign } from "@/lib/campaign";

export function HomeRoute() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });

  const target = data === undefined ? undefined : pickLastCampaign(data);
  // `replace`: the redirect must not sit in the history, or "back" from the
  // pool would bounce straight forward again.
  if (target !== undefined) return <Navigate to={`/${target}`} replace />;

  return (
    <section className="mx-auto max-w-[560px] px-7 pt-16 pb-20 text-[14.5px] text-muted-foreground">
      {isPending && <p>Kampagne wird geöffnet …</p>}
      {isError && <p>Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.</p>}
      {data !== undefined && <p>Keine Kampagne gefunden — Kampagne mit „grimoire seed“ importieren</p>}
    </section>
  );
}
