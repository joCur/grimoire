// "Kampagne bearbeiten" — the one edit action of the chapter overview header,
// and the dialog behind it over the campaign's name, description and text.
// The header shows exactly these three, so they are edited right where they
// are read.
//
// All three are fields of the campaign, so one guarded write carries what
// changed (./use-campaign-edit.ts). The version it is checked against is the
// one the FORM was built from, which is why the form is a component of its
// own, mounted once the campaign has been read: the 5s version poll keeps
// refetching the campaign while the dialog stands, and taking the poll's
// version would turn a concurrent edit into a silent overwrite instead of the
// 409 that asks. On a conflict the typed values stay and the shared conflict
// line offers the two answers — continue from the stored campaign, or write
// the changed fields on top of it.
//
// On success the campaign list is invalidated too: the switcher label and the
// overview header read the name and the description from it.

import type { Campaign } from "@grimoire/shared/campaign";
import { useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useState } from "react";

import { EditConflict } from "@/components/EditConflict";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

import {
  campaignFormChange,
  campaignFormValues,
  canSubmitCampaignForm,
  type CampaignFormValues,
} from "./campaign-form";
import { campaignQuery } from "./campaign-query";
import { useCampaignEdit } from "./use-campaign-edit";

/** The quiet trigger; the dialog itself mounts only while it is open. */
export function CampaignEditAction({ campaign }: { campaign: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (campaign === "") return null;

  return (
    <>
      <HeaderAction icon={PenLine} label={t("common.edit")} onClick={() => setOpen(true)} />
      {open && <CampaignEditDialog campaign={campaign} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The shell: it reads the campaign and mounts the form on the answer. Every
 * campaign route names an existing campaign, so an error here means the
 * server is not reachable.
 */
function CampaignEditDialog({ campaign, onClose }: { campaign: string; onClose: () => void }) {
  const t = useT();
  const read = useQuery({ ...campaignQuery(campaign), retry: false });

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-32px)] max-w-[560px] flex-col"
      >
        <DialogTitle>{t("campaignEdit.title")}</DialogTitle>
        <DialogDescription>{t("campaignEdit.description")}</DialogDescription>
        {read.data === undefined ? (
          <p aria-live="polite" className="mt-4 min-h-[17px] text-[12px] text-destructive">
            {read.isError ? t("campaignEdit.unreachable") : ""}
          </p>
        ) : (
          <CampaignEditForm campaign={read.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

const FIELD_CLASS =
  "w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]";

function CampaignEditForm({
  campaign,
  onClose,
}: {
  /** The campaign as it was read — the version the session writes against. */
  campaign: Campaign;
  onClose: () => void;
}) {
  const t = useT();
  // What the change is measured against, taken when the form opened — NOT the
  // campaign behind it. It moves only when the DM adopts the stored campaign.
  const [initial, setInitial] = useState<CampaignFormValues>(() => campaignFormValues(campaign));
  const [values, setValues] = useState<CampaignFormValues>(initial);
  const set = (key: keyof CampaignFormValues) => (value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const save = useCampaignEdit(campaign, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that campaign.
    onReload: (stored) => {
      const refilled = campaignFormValues(stored);
      setInitial(refilled);
      setValues(refilled);
    },
    // The switcher and the overview header read the campaign list; the
    // campaign is indexed for ⌘K.
    invalidateOnSuccess: [["campaigns"], ["search", campaign.id]],
  });

  const change = campaignFormChange(initial, values);
  const canSubmit =
    canSubmitCampaignForm(values) && Object.keys(change).length > 0 && !save.isSaving;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        save.save(change);
      }}
      className="mt-4 flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-body-secondary">{t("campaignEdit.field.name")}</span>
          <input
            // Radix focuses the first focusable element on open — this input.
            value={values.name}
            onChange={(e) => set("name")(e.target.value)}
            autoComplete="off"
            placeholder={campaign.id}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-body-secondary">
            {t("campaignEdit.field.description")}
          </span>
          <textarea
            rows={3}
            value={values.description}
            onChange={(e) => set("description")(e.target.value)}
            placeholder={t("campaignEdit.field.description.placeholder")}
            className={`${FIELD_CLASS} resize-y leading-[1.55]`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-body-secondary">{t("campaignEdit.field.body")}</span>
          <textarea
            rows={8}
            value={values.body}
            onChange={(e) => set("body")(e.target.value)}
            placeholder={t("campaignEdit.field.body.placeholder")}
            className={`${FIELD_CLASS} resize-y font-mono text-[13px] leading-[1.6]`}
          />
        </label>
      </div>

      <p aria-live="polite" className="min-h-[17px] pt-2 text-[12px] text-destructive">
        {save.message ?? ""}
      </p>

      {/* A refused write asks instead of deciding: the typed values are
          untouched and both answers stand above the buttons. */}
      {save.conflict !== undefined && (
        <div className="pb-2">
          <EditConflict onReload={save.reload} onForce={save.forceSave} busy={save.isSaving} />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          disabled={!canSubmit}
          className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {save.isSaving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
