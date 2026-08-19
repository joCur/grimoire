// "/" — campaign list. Deliberately small: the pool is the home of a
// campaign; this route only picks one.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { fetchCampaigns } from "@/api";

export function CampaignsRoute() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });

  return (
    <section className="mx-auto max-w-[760px] space-y-4 px-7 pt-10 pb-20">
      <h1 className="font-serif text-[28px] leading-[1.25] font-semibold text-foreground">
        Kampagnen
      </h1>
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
        <ul>
          {data.map((campaign) => (
            <li key={campaign.id}>
              <Link
                className="flex items-center rounded-md border-b border-divider px-2.5 py-[13px] text-[14.5px] text-foreground hover:bg-card"
                to={`/${campaign.id}`}
              >
                {campaign.id}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
