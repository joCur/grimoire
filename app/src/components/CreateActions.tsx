// The four „… anlegen" entry points (issue #56) — trigger plus wiring around
// the shared CreateDialog. The campaign's own create is not here: it is the
// cold-start surface of routes/home.tsx, which is a page, not an action next
// to existing content.
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

import { createChapter, createLocation, createNpc, createScene } from "@/api";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { HeaderAction } from "@/components/HeaderAction";
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
  const [open, setOpen] = useState(false);
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "") return null;

  return (
    <>
      <CreateTrigger label="Kapitel anlegen" variant={variant} onClick={() => setOpen(true)} />
      {open && (
        <CreateDialog
          title="Kapitel anlegen"
          description="Der Titel wird zur id des Kapitels — sie steht in jeder Szenen-Adresse und bleibt, wie sie ist. Das Ziel ist optional und landet unter „Ziel des Kapitels“."
          nameLabel="Titel"
          namePlaceholder="01 Salzhafen"
          addressPrefix=""
          extra={{
            label: "Ziel des Kapitels (optional)",
            placeholder: "Was die Gruppe hier erreichen soll",
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
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "" || chapter === "") return null;

  return (
    <>
      <CreateTrigger label="Szene anlegen" variant={variant} onClick={() => setOpen(true)} />
      {open && (
        <CreateDialog
          title="Szene anlegen"
          description="Die Szene entsteht als Entwurf in diesem Kapitel und öffnet gleich im Editor. Der Titel wird zur id — sie bleibt, wie sie ist."
          nameLabel="Titel"
          namePlaceholder="Ankunft am Leuchtturm"
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
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "") return null;

  return (
    <>
      <CreateTrigger label="NPC anlegen" variant="quiet" onClick={() => setOpen(true)} />
      {open && (
        <CreateDialog
          title="NPC anlegen"
          description="Nur der Name — Rolle, Status und alles Weitere stehen danach im Eigenschaften-Dialog. Aus dem Namen wird die id, und die bleibt."
          nameLabel="Name"
          namePlaceholder="Alte Fischerin"
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
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign);
  if (campaign === "") return null;

  return (
    <>
      <CreateTrigger label="Ort anlegen" variant="quiet" onClick={() => setOpen(true)} />
      {open && (
        <CreateDialog
          title="Ort anlegen"
          description="Nur der Name — alles Weitere steht danach im Eigenschaften-Dialog. Aus dem Namen wird die id, und die bleibt."
          nameLabel="Name"
          namePlaceholder="Hafen"
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
