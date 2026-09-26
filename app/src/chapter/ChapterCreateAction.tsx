// The create-chapter action in the chapter overview header, next to the edit action —
// the overview IS the chapter list, so this is where a chapter is missing
// from. The dialog asks for a title (and, behind the pencil, the id) and an
// optional description, which becomes the chapter's text. A created chapter
// stays where it is: the overview now lists it, with its own create-scene
// action underneath, which is the actual next step.

import { useState } from "react";

import { CreateTrigger, useAfterCreate } from "@/components/CreateActions";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { useT } from "@/i18n";

import { createChapter } from "./chapter-api";

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
          extra={{
            label: t("create.chapter.descriptionLabel"),
            placeholder: t("create.chapter.descriptionPlaceholder"),
            multiline: true,
          }}
          create={async (values: CreateValues) => {
            await createChapter(campaign, {
              title: values.name,
              ...(values.extra === undefined ? {} : { body: values.extra }),
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
