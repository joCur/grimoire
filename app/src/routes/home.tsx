// "/" — normally no page at all (issue #14): it redirects into the last active
// campaign, so opening Grimoire lands directly where the DM left off. The
// heuristic is server-side data (`lastSession` per campaign, no localStorage —
// the server is the truth); the switcher in the topbar stays the only way to
// change campaigns.
//
// The one case that DOES render here is the COLD START (issue #56), and since
// issue #79 it is the normal first screen of a fresh installation: the boot
// imports nothing, so a new instance has no campaign at all. What stood here
// was "Kampagne mit „grimoire seed“ importieren" — true, but a shell command,
// i.e. a dead end for the person the tool is for. So this is a form: a name, an
// optional sentence, and the id is derived from the name (the shared slug rule)
// and shown before it is created, because an id is permanent.
//
// A PAGE, not a dialog. There is nothing behind it to keep visible, the surface
// has to work at 390px, and „Kampagne anlegen" is the only thing this screen is
// about. On success the redirect below picks the new campaign up — the pool
// then carries the next step („Kapitel anlegen").

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { createCampaign, fetchCampaigns } from "@/api";
import { Button } from "@/components/ui/button";
import { IconLogo } from "@/icons";
import { pickLastCampaign } from "@/lib/campaign";
import {
  canCreate,
  createConflict,
  createErrorMessage,
  derivedId,
  type CreateConflict,
} from "@/lib/create";

export function HomeRoute() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });

  const target = data === undefined ? undefined : pickLastCampaign(data);
  // `replace`: the redirect must not sit in the history, or "back" from the
  // pool would bounce straight forward again.
  if (target !== undefined) return <Navigate to={`/${target}`} replace />;

  if (isPending) {
    return (
      <section className="mx-auto max-w-[560px] px-5 pt-16 pb-20 text-[14.5px] text-muted-foreground md:px-7">
        <p>Kampagne wird geöffnet …</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="mx-auto max-w-[560px] px-5 pt-16 pb-20 text-[14.5px] text-muted-foreground md:px-7">
        <p>Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.</p>
      </section>
    );
  }
  return <ColdStart />;
}

/** The empty instance: the first campaign is created right here. */
function ColdStart() {
  const nameId = useId();
  const descriptionId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conflict, setConflict] = useState<CreateConflict>();
  const [message, setMessage] = useState("");

  const create = useMutation({
    mutationFn: (id?: string) =>
      createCampaign({
        name: name.trim(),
        ...(description.trim() === "" ? {} : { description: description.trim() }),
        ...(id === undefined ? {} : { id }),
      }),
    onMutate: () => {
      setConflict(undefined);
      setMessage("");
    },
    onSuccess: async (campaign) => {
      // The switcher and this very page read the campaign list, so it must be
      // refetched BEFORE the pool mounts — otherwise the new campaign's own
      // header would render off a list that does not know it yet.
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await navigate(`/${campaign.id}`, { replace: true });
    },
    onError: (error) => {
      setConflict(createConflict(error));
      setMessage(createErrorMessage(error));
    },
  });

  const trimmed = name.trim();
  const id = derivedId(trimmed);
  const canSubmit = canCreate(trimmed) && !create.isPending;

  return (
    <section className="mx-auto max-w-[520px] px-5 pt-12 pb-20 md:px-7 md:pt-16">
      <div className="mb-4 flex items-center gap-2.5">
        <IconLogo size={22} className="text-primary" />
        <h1 className="font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
          Willkommen bei Grimoire
        </h1>
      </div>
      <p className="mb-6 text-[14px] leading-[1.6] text-body-secondary">
        Noch keine Kampagne. Leg eine an — danach entstehen darin Kapitel und Szenen.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          create.mutate(undefined);
        }}
        className="flex flex-col gap-3.5"
      >
        <label htmlFor={nameId} className="flex flex-col gap-1.5">
          <span className="text-[12px] text-body-secondary">Name der Kampagne</span>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            placeholder="Die Küste von Salzhafen"
            className="w-full rounded-md border border-input bg-panel-deep px-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
          />
          {/* The id the name produces — it goes into every URL and stays. */}
          <span className="min-h-[16px] font-mono text-[11.5px] text-muted-foreground">
            {id === "" ? "" : `id: ${id}`}
          </span>
        </label>

        <label htmlFor={descriptionId} className="flex flex-col gap-1.5">
          <span className="text-[12px] text-body-secondary">Beschreibung (optional)</span>
          <textarea
            id={descriptionId}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ein Satz, der die Kampagne einordnet"
            className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] leading-[1.55] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
          />
        </label>

        <div aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
          {message}
          {conflict !== undefined && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => create.mutate(conflict.suggestion)}
                className="rounded-sm text-body-secondary underline underline-offset-2 hover:text-foreground"
              >
                „{conflict.suggestion}" verwenden
              </button>
            </>
          )}
        </div>

        <div>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="h-auto min-h-11 px-4 py-2 text-[13.5px] font-semibold"
          >
            {create.isPending ? "Lege an …" : "Kampagne anlegen"}
          </Button>
        </div>
      </form>
    </section>
  );
}
