// The „… anlegen" entry points (issue #56) — trigger plus wiring around the
// shared CreateDialog.
//
// The CAMPAIGN has two surfaces and both run through `useCampaignCreate` here,
// so they cannot drift apart: the cold-start PAGE (routes/home.tsx — an empty
// instance has nothing behind a dialog worth keeping visible) and
// `CampaignCreateDialog`, which the topbar switcher opens on an instance that
// already runs (PO feedback on issue #56: a SECOND campaign had no entry point
// in the UI at all, which is the dead end this ticket exists to remove). Same
// fields, same id preview, same 409 proposal.
//
// PLACEHOLDERS ARE GENERIC (same feedback): every field hint names the KIND of
// thing that belongs there („Titel der Szene", „Name des Orts"), never a name
// out of `examples/` — a placeholder that reads like real campaign content is
// taken for a default.
//
// WHERE THEY SIT, and why:
//
//   Kapitel   the pool header, next to „Bearbeiten" — the pool IS the chapter
//             list, so this is where a chapter is missing from.
//   Szene     inside a chapter accordion, so the chapter is prefilled BY
//             POSITION and the dialog needs no chapter picker at all.
//   NPC/Ort   the head of their list pages — the only surfaces that show all
//             of them, and the ones a phone can reach (issue #11).
//
// WHAT HAPPENS AFTER a successful create differs per kind, and that is the
// point of having four wrappers rather than one:
//
//   a SCENE opens immediately in the editor (`?edit=1`) — a scene with a title
//     and nothing else is an invitation to write, and the composer is that
//     invitation. Nobody creates a scene in order to look at its empty body.
//   an NPC/ORT opens its reading view, where „Eigenschaften" carries the rest
//     of the fields (issue #42) — the dialog deliberately asks for a name only.
//   a CHAPTER stays where it is: the pool now lists it, with its own
//     „Szene anlegen" underneath, which is the actual next step.
//
// Every one of them invalidates the tree (every list and the pool read it),
// the campaign list (its counts) and the search index view.

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { createCampaign, createChapter, createLocation, createNpc, createScene } from "@/api";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { HeaderAction } from "@/components/HeaderAction";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Queries that go stale when anything is created. */
function invalidationKeys(campaign: string) {
  return [["tree", campaign], ["campaigns"], ["search", campaign]];
}

function useAfterCreate(campaign: string) {
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
 * the new campaign's own header read that list, so a pool mounting off a list
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
    await navigate(`/${campaign.id}`, { replace });
    return campaign;
  };
}

/**
 * „Kampagne anlegen" on a running instance — opened from the topbar switcher,
 * which is where the question „and where is the second campaign?" comes up.
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
function CreateTrigger({
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
            label: t("create.chapter.goalLabel"),
            placeholder: t("create.chapter.goalPlaceholder"),
            multiline: true,
          }}
          create={async (values: CreateValues) => {
            await createChapter(campaign, {
              title: values.name,
              ...(values.extra === undefined ? {} : { goal: values.extra }),
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

export function SceneCreateAction({
  campaign,
  chapter,
  variant = "quiet",
}: {
  campaign: string;
  /** The chapter id — prefilled by position, never asked for. */
  chapter: string;
  variant?: "quiet" | "primary";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "" || chapter === "") return null;

  return (
    <>
      <CreateTrigger
        label={t("create.scene.title")}
        variant={variant}
        onClick={() => setOpen(true)}
      />
      {open && (
        <CreateDialog
          title={t("create.scene.title")}
          description={t("create.scene.description")}
          nameLabel={t("create.scene.nameLabel")}
          namePlaceholder={t("create.scene.namePlaceholder")}
          addressPrefix={`${chapter}/`}
          create={async (values: CreateValues) => {
            const created = await createScene(campaign, {
              title: values.name,
              chapter,
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
            // Straight into the composer — an empty scene is there to be written.
            await navigate(`/${campaign}/file/${created.path}?edit=1`);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function NpcCreateAction({ campaign }: { campaign: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "") return null;

  return (
    <>
      <CreateTrigger
        label={t("create.npc.title")}
        variant="quiet"
        onClick={() => setOpen(true)}
      />
      {open && (
        <CreateDialog
          title={t("create.npc.title")}
          description={t("create.npc.description")}
          nameLabel={t("create.npc.nameLabel")}
          namePlaceholder={t("create.npc.namePlaceholder")}
          addressPrefix="npcs/"
          create={async (values: CreateValues) => {
            const created = await createNpc(campaign, {
              name: values.name,
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
            await navigate(`/${campaign}/file/${created.path}`);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function LocationCreateAction({ campaign }: { campaign: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "") return null;

  return (
    <>
      <CreateTrigger
        label={t("create.location.title")}
        variant="quiet"
        onClick={() => setOpen(true)}
      />
      {open && (
        <CreateDialog
          title={t("create.location.title")}
          description={t("create.location.description")}
          nameLabel={t("create.location.nameLabel")}
          namePlaceholder={t("create.location.namePlaceholder")}
          addressPrefix="locations/"
          create={async (values: CreateValues) => {
            const created = await createLocation(campaign, {
              name: values.name,
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
            await navigate(`/${campaign}/file/${created.path}`);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
