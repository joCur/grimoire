// The create entry points — trigger plus wiring around the shared
// CreateDialog. The scene's, the npc's and the location's live in their own
// slices (app/src/scene/, app/src/npc/, app/src/location/), built from the
// trigger and the after-create step exported here.
//
// The CAMPAIGN has two surfaces and both run through `useCampaignCreate` here,
// so they cannot drift apart: the cold-start PAGE (routes/home.tsx — an empty
// instance has nothing behind a dialog worth keeping visible) and
// `CampaignCreateDialog`, which the topbar switcher opens on an instance that
// already runs — without it a SECOND campaign would have no entry point in
// the UI at all. Same fields, same id preview, same 409 proposal.
//
// PLACEHOLDERS ARE GENERIC: every field hint names the KIND of
// thing that belongs there (the scene's title, the location's name), never a
// name out of the example campaign — a placeholder that reads like real
// campaign content is taken for a default.
//
// WHERE THEY SIT, and why:
//
//   chapter   the chapter overview header, next to the edit action — the
//             overview IS the chapter list, so this is where a chapter is
//             missing from.
//   scene     inside a chapter accordion, so the chapter is prefilled BY
//             POSITION and the dialog needs no chapter picker at all.
//   npc /     the head of their list pages — the only surfaces that show all
//   location  of them, and the ones a phone can reach.
//
// WHAT HAPPENS AFTER a successful create differs, and that is the point of
// having a wrapper each rather than one:
//
//   a SCENE opens immediately in the editor (`?edit=1`) — a scene with a title
//     and nothing else is an invitation to write, and the composer is that
//     invitation. Nobody creates a scene in order to look at its empty body.
//   an NPC/LOCATION opens its reading view, where the properties dialog
//     carries the rest of the fields — the dialog deliberately asks for a name
//     only.
//   a CHAPTER stays where it is: the chapter overview now lists it, with its
//     own create-scene action underneath, which is the actual next step.
//
// Every one of them invalidates the tree (every list and the chapter overview read it),
// the campaign list (its counts) and the search index view.

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { createCampaign, createChapter } from "@/api";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { HeaderAction } from "@/components/HeaderAction";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { locationsKey } from "@/location/location-query";
import { npcsKey } from "@/npc/npc-query";

/** Queries that go stale when anything is created. */
function invalidationKeys(campaign: string) {
  return [
    ["tree", campaign],
    ["campaigns"],
    ["search", campaign],
    npcsKey(campaign),
    locationsKey(campaign),
  ];
}

/** The step after every create: the lists that read the new row are refetched. */
export function useAfterCreate(campaign: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all(
      invalidationKeys(campaign).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}

/** What a campaign create sends — the cold-start page and the switcher dialog
 *  both produce exactly this. */
export interface CampaignCreateInput {
  name: string;
  description?: string;
  /** Only set when the DM took the collision proposal. */
  id?: string;
}

/**
 * The campaign create both surfaces share: POST, refresh the campaign list,
 * open the new campaign.
 *
 * The invalidation happens BEFORE the navigation on purpose — the switcher and
 * the new campaign's own header read that list, so a chapter overview mounting off a list
 * that does not know the campaign yet would render without its name.
 *
 * `replace` is the difference between the two: the cold start replaces "/"
 * (the redirect must not sit in the history, or "back" would bounce forward
 * again), while switching campaigns from the topbar is a normal step.
 */
export function useCampaignCreate({ replace = false }: { replace?: boolean } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async (input: CampaignCreateInput) => {
    const campaign = await createCampaign(input);
    await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    await navigate(`/campaigns/${campaign.id}`, { replace });
    return campaign;
  };
}

/**
 * Campaign create on a running instance — opened from the topbar switcher,
 * which is where the question "and where is the second campaign?" comes up.
 * The dialog only differs from the cold-start page in being a dialog; the
 * fields, the id preview and the 409 branch are the shared ones.
 */
export function CampaignCreateDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const createCampaignFlow = useCampaignCreate();
  return (
    <CreateDialog
      title={t("create.campaign.title")}
      nameLabel={t("create.campaign.nameLabel")}
      namePlaceholder={t("create.campaign.namePlaceholder")}
      addressPrefix={t("create.campaign.idPrefix")}
      extra={{
        label: t("create.campaign.descriptionLabel"),
        placeholder: t("create.campaign.descriptionPlaceholder"),
        multiline: true,
      }}
      create={async (values: CreateValues) => {
        await createCampaignFlow({
          name: values.name,
          ...(values.extra === undefined ? {} : { description: values.extra }),
          ...(values.id === undefined ? {} : { id: values.id }),
        });
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/**
 * The trigger. `variant: "primary"` is the empty state's next step — a real
 * button, because there is nothing else on the surface to be quiet next to;
 * everywhere else it is the header vocabulary of the reading view.
 */
export function CreateTrigger({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "quiet" | "primary";
  onClick: () => void;
}) {
  if (variant === "primary") {
    return (
      <Button
        type="button"
        onClick={onClick}
        className="h-auto min-h-11 px-4 py-2 text-[13.5px] font-semibold"
      >
        {label}
      </Button>
    );
  }
  return <HeaderAction icon={Plus} label={label} onClick={onClick} />;
}

export function ChapterCreateAction({
  campaign,
  variant = "quiet",
}: {
  campaign: string;
  variant?: "quiet" | "primary";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "") return null;

  return (
    <>
      <CreateTrigger
        label={t("create.chapter.title")}
        variant={variant}
        onClick={() => setOpen(true)}
      />
      {open && (
        <CreateDialog
          title={t("create.chapter.title")}
          description={t("create.chapter.description")}
          nameLabel={t("create.chapter.nameLabel")}
          namePlaceholder={t("create.chapter.namePlaceholder")}
          addressPrefix=""
          extra={{
            label: t("create.chapter.descriptionLabel"),
            placeholder: t("create.chapter.descriptionPlaceholder"),
            multiline: true,
          }}
          create={async (values: CreateValues) => {
            await createChapter(campaign, {
              title: values.name,
              ...(values.extra === undefined ? {} : { description: values.extra }),
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
