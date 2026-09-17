// „Bearbeiten" for the campaign's name and description — offered on the chapter overview
// header and in the campaign entry's reading view, the two places where those
// two values are on screen.
//
// The dialog writes with PATCH /properties and the `rev` it was opened with.
// That token is frozen on purpose: the 5s version poll keeps refetching the
// campaign entry while the dialog stands, and taking the live token at save
// time would let a concurrent edit slip through as a silent overwrite. With
// the frozen token the server answers 409, the dialog shows „Inzwischen
// geändert — neu laden", keeps the typed values and moves its base to the
// re-read entry, so the next „Speichern" writes on top of what is stored now.
//
// On success the campaigns, tree and search queries are invalidated: the
// switcher label and the chapter overview header read the campaign list and must not keep
// the old name.
//
// Prefilled from GET /campaigns, minus the server's id fallback
// (`prefillCampaignName`): an unnamed campaign starts with an empty field and
// the id only as a placeholder — the dialog never proposes the id as a name.

import { useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCampaigns, fetchEntry } from "@/api";
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
  canSubmitCampaignMeta,
  prefillCampaignName,
  seedCampaignMetaBase,
  writeCampaignMeta,
  type CampaignMetaBase,
  type CampaignMetaValues,
} from "@/lib/campaign-meta";
import { useRevWriteMutation } from "@/lib/use-rev-write";

/** The quiet trigger; the dialog itself mounts only while it is open. */
export function CampaignMetaAction({ campaign }: { campaign: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (campaign === "") return null;

  return (
    <>
      <HeaderAction icon={PenLine} label={t("common.edit")} onClick={() => setOpen(true)} />
      {open && <CampaignMetaDialog campaign={campaign} onClose={() => setOpen(false)} />}
    </>
  );
}

function CampaignMetaDialog({
  campaign,
  onClose,
}: {
  campaign: string;
  onClose: () => void;
}) {
  const t = useT();
  // Authored name/description — the same cached list the switcher reads.
  // Prefill and edits are kept apart instead of seeding useState: the list is
  // normally already cached, but if it arrives a tick later the fields must
  // still fill in — and a field the DM already touched must not be reset.
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
  const entry = findCampaign(campaigns.data, campaign);
  const [edited, setEdited] = useState<Partial<CampaignMetaValues>>({});
  const values: CampaignMetaValues = {
    name: prefillCampaignName(campaign, entry?.name),
    description: entry?.description ?? "",
    ...edited,
  };
  const setValue = (key: keyof CampaignMetaValues, value: string) =>
    setEdited((prev) => ({ ...prev, [key]: value }));

  // The campaign entry is the source of the `rev` this dialog writes against.
  // Every campaign has one (it is the campaign row), so an error here means
  // the server is not reachable, never "no such entry".
  const file = useQuery({
    queryKey: ["entry", campaign, CAMPAIGN_META_PATH],
    queryFn: () => fetchEntry(campaign, CAMPAIGN_META_PATH),
    retry: false,
  });
  const unreachable = file.isError;

  // The `rev` the save is checked against, taken from the query's FIRST
  // answer and then held (`seedCampaignMetaBase`). The query itself keeps
  // refetching while the dialog stands; following it would adopt a concurrent
  // edit's token and overwrite that edit silently. The base moves only after
  // a 409, to the `rev` the re-read brought.
  const [base, setBase] = useState<CampaignMetaBase>();
  useEffect(() => {
    setBase((previous) => seedCampaignMetaBase(previous, file.data));
  }, [file.data]);

  const save = useRevWriteMutation<void>({
    // No `rev` yet (still loading, or the entry could not be read) — nothing
    // to write against, so the mutation cannot start.
    write:
      base === undefined ? undefined : () => writeCampaignMeta(campaign, values, base.rev),
    entryKey: ["entry", campaign, CAMPAIGN_META_PATH],
    // The switcher and the chapter overview header read the campaign list; the entry also
    // sits in the tree/search surfaces.
    invalidateOnSuccess: [["campaigns"], ["tree", campaign], ["search", campaign]],
    onSaved: onClose,
    // 409: the entry changed meanwhile. The typed values stay; only the `rev`
    // underneath them moves to the re-read one, so the next „Speichern"
    // writes on top of what is stored now.
    onConflict: (reread) => {
      if (reread !== undefined) setBase({ rev: reread.rev });
    },
  });

  const canSubmit = canSubmitCampaignMeta(values) && !save.isPending && base !== undefined;

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

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            save.write();
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
            {unreachable ? t("campaignMeta.unreachable") : (save.message ?? "")}
          </p>

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
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
