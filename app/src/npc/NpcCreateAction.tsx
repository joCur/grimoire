// "NPC anlegen" at the head of the npc list — the only surface that shows all
// npcs, and one a phone reaches. The dialog asks for a name (and, behind the
// pencil, the id); a created npc opens its reading view, where the dialog
// carries the rest of its fields.

import { useState } from "react";
import { useNavigate } from "react-router";

import { CreateTrigger, useAfterCreate } from "@/components/CreateActions";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { useT } from "@/i18n";

import { createNpc } from "./npc-api";
import { npcHref } from "./npc-links";
import { npcsKey } from "./npc-query";

export function NpcCreateAction({ campaign }: { campaign: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign, npcsKey(campaign));
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
          create={async (values: CreateValues) => {
            const created = await createNpc(campaign, {
              name: values.name,
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
            await navigate(npcHref(campaign, created.id));
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
