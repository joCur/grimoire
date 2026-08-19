// "/" — campaign list. Placeholder view: the real design lands later.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { fetchCampaigns } from "@/api";

export function CampaignsRoute() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">Kampagnen</h1>
      {isPending && <p className="text-muted-foreground">Lade Kampagnen …</p>}
      {isError && (
        <p className="text-muted-foreground">
          Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-muted-foreground">
          Noch keine Kampagnen — Ordner unter dem Kampagnen-Verzeichnis anlegen.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-1">
          {data.map((campaign) => (
            <li key={campaign.id}>
              <Link className="text-primary underline underline-offset-2" to={`/${campaign.id}`}>
                {campaign.id}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
