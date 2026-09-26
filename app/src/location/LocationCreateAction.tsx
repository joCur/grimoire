// "Ort anlegen" at the head of the location list — the only surface that
// shows all locations, and one a phone reaches. The dialog asks for a name
// (and, behind the pencil, the id); a created location opens its reading
// view, where the dialog carries the rest of its fields.

import { useState } from "react";
import { useNavigate } from "react-router";

import { CreateTrigger, useAfterCreate } from "@/components/CreateActions";
import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { useT } from "@/i18n";

import { createLocation } from "./location-api";
import { locationHref } from "./location-links";
import { locationsKey } from "./location-query";

export function LocationCreateAction({ campaign }: { campaign: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const afterCreate = useAfterCreate(campaign, locationsKey(campaign));
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
          create={async (values: CreateValues) => {
            const created = await createLocation(campaign, {
              name: values.name,
              ...(values.id === undefined ? {} : { id: values.id }),
            });
            await afterCreate();
            setOpen(false);
            await navigate(locationHref(campaign, created.id));
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
