// "Szene anlegen" inside a chapter's accordion — the chapter is prefilled BY
// POSITION, so the dialog needs no chapter picker at all. The dialog asks for
// a title (and, behind the pencil, the id); a created scene opens straight in
// its editor (`?edit=1`): a scene with a title and nothing else is an
// invitation to write, and nobody creates one to look at its empty text.

import { useState } from "react";
import { useNavigate } from "react-router";

import { CreateTrigger, useAfterCreate } from "@/components/CreateActions";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { useT } from "@/i18n";

import { createScene } from "./scene-api";
import { sceneHref } from "./scene-links";

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
          addressPrefix="scenes/"
          create={async (values: CreateValues) => {
            const created = await createScene(campaign, {
              title: values.name,
              chapter,
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
            await navigate(`${sceneHref(campaign, created.id)}?edit=1`);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
