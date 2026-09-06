// „Bearbeiten" for the campaign's name and description (issue #34) — offered
// on the pool header and in the campaign file's reading view, the two places
// where those two values are on screen.
//
// The dialog writes through the documented API: PATCH /properties with the
// guard token the open dialog was seeded with — frozen, not the live query
// value, or the 5s version poll would hand it a concurrent edit's token and
// turn the save into a silent overwrite (409 → inline "Inzwischen geändert —
// neu laden", the typed values stay, the next attempt writes on top of what is
// stored now). That is the ONLY write path since issue #62: the create
// endpoint it used for a campaign without `_campaign` is gone, because
// every campaign has a row and therefore always has that document. On success
// the campaigns/tree/search queries are invalidated — the switcher label and
// the pool header read from the campaign list, so they must not keep the old
// name.
//
// Prefilled from GET /campaigns, minus the server's id fallback
// (`prefillCampaignName`): an unnamed campaign starts with an empty field and
// the id only as a placeholder — the dialog never proposes the id as a name.

import { useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCampaigns, fetchFile } from "@/api";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [open, setOpen] = useState(false);
  if (campaign === "") return null;

  return (
    <>
      <HeaderAction icon={PenLine} label="Bearbeiten" onClick={() => setOpen(true)} />
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

  // Where the base version comes from. The campaign document always exists
  // (it is the campaign row), so an error here really is "not reachable".
  const file = useQuery({
    queryKey: ["file", campaign, CAMPAIGN_META_PATH],
    queryFn: () => fetchFile(campaign, CAMPAIGN_META_PATH),
    retry: false,
  });
  const unreachable = file.isError;

  // The version the save is checked against, frozen at the query's first
  // answer (seedCampaignMetaBase explains why): the 5s version poll refetches
  // this document while the dialog stands, and following it would turn a
  // concurrent edit into a silent overwrite instead of a 409. It moves only
  // after a conflict, to the version the re-read brought.
  const [base, setBase] = useState<CampaignMetaBase>();
  useEffect(() => {
    setBase((previous) => seedCampaignMetaBase(previous, file.data));
  }, [file.data]);

  const save = useRevWriteMutation<void>({
    // No base yet (still loading, or the document is not readable) — nothing
    // to write against, so the mutation cannot start.
    write:
      base === undefined ? undefined : () => writeCampaignMeta(campaign, values, base.rev),
    fileKey: ["file", campaign, CAMPAIGN_META_PATH],
    // The switcher and the pool header read the campaign list; the file also
    // sits in the tree/search surfaces.
    invalidateOnSuccess: [["campaigns"], ["tree", campaign], ["search", campaign]],
    onSaved: onClose,
    // The document changed meanwhile: the typed values stay, only the version
    // underneath them moves on, so the next „Speichern" writes on top of what
    // is stored now.
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
        <DialogTitle>Kampagne bearbeiten</DialogTitle>
        <DialogDescription>
          Name und Beschreibung stehen in _campaign. Die id bleibt, wie sie ist — sie steckt
          in jeder Adresse und ändert sich hier nicht.
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            save.write();
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">Name</span>
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
            <span className="text-[12px] text-body-secondary">Beschreibung</span>
            <textarea
              rows={3}
              value={values.description}
              onChange={(e) => setValue("description", e.target.value)}
              placeholder="Ein Satz, der die Kampagne einordnet"
              className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] leading-[1.55] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
            />
          </label>

          <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {unreachable ? "Kampagne nicht ladbar — Server prüfen" : (save.message ?? "")}
          </p>

          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {save.isPending ? "Speichere …" : "Speichern"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
