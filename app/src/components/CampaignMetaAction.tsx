// The dialog for the campaign's name and description — offered on the
// chapter overview header and in the campaign entry's reading view, the two
// places where those two values are on screen.
//
// Its trigger is named after what else stands in that header. On the chapter
// overview it is the only edit there is, so it is called „Bearbeiten". In the
// campaign entry's reading view the body editor owns that label, and the
// dialog is the properties half of the same pair as everywhere else — so it
// takes the properties name and glyph there. Two triggers with one name on one
// surface are ambiguous for a screen reader and for a keyboard user counting
// Tab stops.
//
// Both values are properties of the campaign entry, so one guarded write
// carries them (lib/use-entry-edit.ts). The version it is checked against is
// the one the FORM was built from, which is why the form is a component of its
// own, mounted once the campaign entry has been read: the 5s version poll
// keeps refetching that entry while the dialog stands, and there is no moment
// at which the session may take the poll's version — that is how a concurrent
// edit turns into a silent overwrite instead of the 409 that asks. On a
// conflict the typed values stay and the shared conflict line offers the two
// answers.
//
// On success the campaigns, tree and search queries are invalidated: the
// switcher label and the chapter overview header read the campaign list and
// must not keep the old name.
//
// Prefilled from GET /campaigns, minus the server's id fallback
// (`prefillCampaignName`): an unnamed campaign starts with an empty field and
// the id only as a placeholder — the dialog never proposes the id as a name.

import type { EntryResponse } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { PenLine, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { fetchCampaigns, fetchEntry } from "@/api";
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
import { findCampaign } from "@/lib/campaign";
import {
  CAMPAIGN_META_PATH,
  campaignMetaPatch,
  canSubmitCampaignMeta,
  prefillCampaignName,
  type CampaignMetaValues,
} from "@/lib/campaign-meta";
import { useEntryEdit } from "@/lib/use-entry-edit";

/** The quiet trigger; the dialog itself mounts only while it is open. */
export function CampaignMetaAction({
  campaign,
  as = "edit",
}: {
  campaign: string;
  /**
   * How the trigger is NAMED, per surface: the plain edit action where it is
   * the only one, the properties action where the body editor stands next to
   * it. The dialog is the same either way — same form, same editing session,
   * same 409.
   */
  as?: "edit" | "properties";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (campaign === "") return null;
  const properties = as === "properties";

  return (
    <>
      <HeaderAction
        icon={properties ? SlidersHorizontal : PenLine}
        label={properties ? t("properties.action") : t("common.edit")}
        onClick={() => setOpen(true)}
      />
      {open && <CampaignMetaDialog campaign={campaign} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The shell: it reads the campaign entry and mounts the form on the answer.
 *
 * Every campaign HAS that entry (it is the campaign row), so an error here
 * means the server is not reachable, never "no such entry".
 */
function CampaignMetaDialog({
  campaign,
  onClose,
}: {
  campaign: string;
  onClose: () => void;
}) {
  const t = useT();
  const entry = useQuery({
    queryKey: ["entry", campaign, CAMPAIGN_META_PATH],
    queryFn: () => fetchEntry(campaign, CAMPAIGN_META_PATH),
    retry: false,
  });

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[460px]">
        <DialogTitle>{t("campaignMeta.title")}</DialogTitle>
        <DialogDescription>{t("campaignMeta.description")}</DialogDescription>
        {entry.data === undefined || entry.data.kind === "location" ? (
          <p aria-live="polite" className="mt-4 min-h-[17px] text-[12px] text-destructive">
            {entry.isError ? t("campaignMeta.unreachable") : ""}
          </p>
        ) : (
          <CampaignMetaForm campaign={campaign} entry={entry.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CampaignMetaForm({
  campaign,
  entry,
  onClose,
}: {
  campaign: string;
  /** The campaign entry as it was read — the version the session writes against. */
  entry: EntryResponse;
  onClose: () => void;
}) {
  const t = useT();
  // Authored name/description — the same cached list the switcher reads.
  // Prefill and edits are kept apart instead of seeding useState: the list is
  // normally already cached, but if it arrives a tick later the fields must
  // still fill in — and a field the DM already touched must not be reset.
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
  const listed = findCampaign(campaigns.data, campaign);
  const [edited, setEdited] = useState<Partial<CampaignMetaValues>>({});
  const values: CampaignMetaValues = {
    name: prefillCampaignName(campaign, listed?.name),
    description: listed?.description ?? "",
    ...edited,
  };
  const setValue = (key: keyof CampaignMetaValues, value: string) =>
    setEdited((prev) => ({ ...prev, [key]: value }));

  const save = useEntryEdit(campaign, CAMPAIGN_META_PATH, entry.rev, {
    onSaved: onClose,
    onReload: () => {
      // Continue from what is stored: dropping the edits lets the prefill from
      // the campaign list show through again, which the successful write of
      // the other writer has already refreshed.
      setEdited({});
    },
    // The switcher and the chapter overview header read the campaign list; the
    // entry also sits in the tree and search surfaces.
    invalidateOnSuccess: [["campaigns"], ["tree", campaign], ["search", campaign]],
  });

  const canSubmit = canSubmitCampaignMeta(values) && !save.isSaving;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        save.save({ properties: campaignMetaPatch(values) });
      }}
      className="mt-4 flex flex-col gap-3.5"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-body-secondary">{t("campaignMeta.field.name")}</span>
        <input
          // Radix focuses the first focusable element on open — this input.
          value={values.name}
          onChange={(e) => setValue("name", e.target.value)}
          autoComplete="off"
          placeholder={campaign}
          className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-body-secondary">
          {t("campaignMeta.field.description")}
        </span>
        <textarea
          rows={3}
          value={values.description}
          onChange={(e) => setValue("description", e.target.value)}
          placeholder={t("campaignMeta.field.description.placeholder")}
          className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] leading-[1.55] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
        />
      </label>

      <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
        {save.message ?? ""}
      </p>

      {/* A refused write asks instead of deciding: the typed values are
          untouched and both answers stand above the buttons. */}
      {save.conflict !== undefined && (
        <EditConflict onReload={save.reload} onForce={save.forceSave} busy={save.isSaving} />
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
