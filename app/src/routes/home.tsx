// "/" — normally no page at all: it redirects into the last active
// campaign, so opening Grimoire lands directly where the DM left off. The
// heuristic is server-side data (`lastSession` per campaign, no localStorage —
// the server is the truth); the switcher in the topbar stays the only way to
// change campaigns.
//
// The one case that DOES render here is the COLD START, the normal first
// screen of a fresh installation: the boot imports nothing, so a new instance
// has no campaign at all. Pointing the DM at a shell command would be a dead
// end for the person the tool is for, so this is a form: a name, an optional
// sentence, and the id is derived from the name (the shared slug rule) and
// shown before it is created, because an id is permanent.
//
// A PAGE, not a dialog. There is nothing behind it to keep visible, the
// surface has to work at 390px, and creating a campaign is the only thing this
// screen is about. On success the redirect below picks the new campaign up —
// the chapter overview then carries the next step, creating a chapter.
//
// The SECOND campaign is created from the topbar switcher instead, through the
// same `useCampaignCreate` (components/CreateActions.tsx) — one create, two
// surfaces. The field hints here are generic (the campaign's name): a
// placeholder naming the example campaign reads like a default.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Navigate } from "react-router";

import { fetchCampaigns } from "@/api";
import { useCampaignCreate } from "@/components/CreateActions";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Button } from "@/components/ui/button";
import { IconLogo } from "@/icons";
import { useT } from "@/i18n";
import { pickLastCampaign } from "@/lib/campaign";
import {
  canCreate,
  createConflict,
  createErrorMessage,
  derivedId,
  type CreateConflict,
} from "@/lib/create";

export function HomeRoute() {
  const t = useT();
  const { data, isPending, isError } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });

  const target = data === undefined ? undefined : pickLastCampaign(data);
  // `replace`: the redirect must not sit in the history, or "back" from the
  // chapter overview would bounce straight forward again.
  if (target !== undefined) return <Navigate to={`/campaigns/${target}`} replace />;

  if (isPending) {
    return (
      <section className="mx-auto max-w-[560px] px-5 pt-16 pb-20 text-[14.5px] text-muted-foreground md:px-7">
        <p>{t("home.opening")}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="mx-auto max-w-[560px] px-5 pt-16 pb-20 text-[14.5px] text-muted-foreground md:px-7">
        <p>{t("common.serverDown")}</p>
      </section>
    );
  }
  return <ColdStart />;
}

/** The empty instance: the first campaign is created right here. */
function ColdStart() {
  const t = useT();
  const nameId = useId();
  const descriptionId = useId();
  // Shared with the switcher's campaign create dialog (components/
  // CreateActions.tsx) — one create, two surfaces. `replace`: the redirect
  // must not sit in the history, or "back" would bounce straight forward again.
  const createCampaignFlow = useCampaignCreate({ replace: true });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conflict, setConflict] = useState<CreateConflict>();
  const [message, setMessage] = useState("");

  const create = useMutation({
    mutationFn: (id?: string) =>
      createCampaignFlow({
        name: name.trim(),
        ...(description.trim() === "" ? {} : { description: description.trim() }),
        ...(id === undefined ? {} : { id }),
      }),
    onMutate: () => {
      setConflict(undefined);
      setMessage("");
    },
    onError: (error) => {
      setConflict(createConflict(error));
      setMessage(createErrorMessage(error, t));
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
          {t("coldstart.title")}
        </h1>
      </div>
      <p className="mb-6 text-[14px] leading-[1.6] text-body-secondary">
        {t("coldstart.lead")}
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
          <span className="text-[12px] text-body-secondary">
            {t("create.campaign.nameLabel")}
          </span>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            placeholder={t("create.campaign.namePlaceholder")}
            className="w-full rounded-md border border-input bg-panel-deep px-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
          />
          {/* The id the name produces — it goes into every URL and stays. */}
          <span className="min-h-[16px] font-mono text-[11.5px] text-muted-foreground">
            {id === "" ? "" : t("coldstart.id", { id })}
          </span>
        </label>

        <label htmlFor={descriptionId} className="flex flex-col gap-1.5">
          <span className="text-[12px] text-body-secondary">
            {t("create.campaign.descriptionLabel")}
          </span>
          <textarea
            id={descriptionId}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("create.campaign.descriptionPlaceholder")}
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
                {t("create.useSuggestion", { id: conflict.suggestion })}
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
            {t(create.isPending ? "common.creating" : "create.campaign.title")}
          </Button>
        </div>
      </form>

      {/* The language switch. There is no campaign yet,
          so the topbar carries no switcher — without this row the FIRST screen
          of a new installation would be the one screen whose language cannot be
          changed. A footer, hairline above, well below the form: the first
          thing to do here is still „Kampagne anlegen". */}
      <footer className="mt-10 border-t border-divider pt-3.5">
        <LanguageSwitch />
      </footer>
    </section>
  );
}
