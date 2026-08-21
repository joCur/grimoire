// „Bearbeiten" for the campaign's name and description (issue #34) — offered
// on the pool header and in the campaign file's reading view, the two places
// where those two values are on screen.
//
// The dialog writes through the documented API: PATCH /frontmatter with the
// mtime of the `_campaign.md` it read (409 → inline "Datei extern geändert —
// neu laden" plus a refetch, nothing lost), or POST /campaign-meta when the
// campaign has no metadata file yet. On success the campaigns/tree/file
// queries are invalidated — the switcher label and the pool header read from
// the campaign list, so they must not keep the old name.
//
// Prefilled from the AUTHORED values of GET /campaigns (which drops the
// parser's id fallback), so an unnamed campaign starts with an empty field and
// the id only as a placeholder — the dialog never proposes the id as a name.

import { useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useState } from "react";

import { ApiError, fetchCampaigns, fetchFile } from "@/api";
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
  writeCampaignMeta,
  type CampaignMetaValues,
} from "@/lib/campaign-meta";
import { useMtimeWriteMutation } from "@/lib/use-mtime-write";

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
    name: entry?.name ?? "",
    description: entry?.description ?? "",
    ...edited,
  };
  const setValue = (key: keyof CampaignMetaValues, value: string) =>
    setEdited((prev) => ({ ...prev, [key]: value }));

  // The mtime for the patch — and the answer to "is there a file at all?".
  // A 404 is the normal "no metadata yet" case, not an error state.
  const file = useQuery({
    queryKey: ["file", campaign, CAMPAIGN_META_PATH],
    queryFn: () => fetchFile(campaign, CAMPAIGN_META_PATH),
    retry: false,
  });
  const missing = file.isError && file.error instanceof ApiError && file.error.status === 404;
  const unreachable = file.isError && !missing;
  const mtimeMs = file.data?.mtimeMs;

  const save = useMtimeWriteMutation<void>({
    write: () => writeCampaignMeta(campaign, values, mtimeMs),
    fileKey: ["file", campaign, CAMPAIGN_META_PATH],
    // The switcher and the pool header read the campaign list; the file also
    // sits in the tree/search surfaces.
    invalidateOnSuccess: [["campaigns"], ["tree", campaign], ["search", campaign]],
    errorMessage: "Nicht gespeichert — Server prüfen",
    onSaved: onClose,
  });

  const loading = file.isPending;
  const canSubmit = canSubmitCampaignMeta(values) && !save.isPending && !loading && !unreachable;

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
          {missing
            ? "Diese Kampagne hat noch keine _campaign.md — sie wird beim Speichern angelegt, mit dem Ordnernamen als id."
            : "Name und Beschreibung stehen in _campaign.md. Der Ordnername bleibt die id — sie steckt in jeder Adresse und ändert sich hier nicht."}
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
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">Beschreibung</span>
            <textarea
              rows={3}
              value={values.description}
              onChange={(e) => setValue("description", e.target.value)}
              placeholder="Ein Satz, der die Kampagne einordnet"
              className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
            />
          </label>

          <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {unreachable
              ? "Kampagnendatei nicht ladbar — Server prüfen"
              : (save.message ?? "")}
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
