// Creating a campaign. It has two surfaces and both run through
// `useCampaignCreate`, so they cannot drift apart: the cold-start PAGE
// (routes/home.tsx — an empty instance has nothing behind a dialog worth
// keeping visible) and `CampaignCreateDialog`, which the topbar switcher opens
// on an instance that already runs — without it a SECOND campaign would have
// no entry point in the UI at all. Same fields, same id preview, same 409
// proposal.

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { CreateDialog, type CreateValues } from "@/components/CreateDialog";
import { useT } from "@/i18n";

import { createCampaign } from "./campaign-api";
import { campaignHref } from "./campaign-links";

/** What a campaign create sends — the cold-start page and the switcher dialog
 *  both produce exactly this. */
export interface CampaignCreateInput {
  name: string;
  description?: string;
  /** Only set when the DM took the collision proposal. */
  id?: string;
}

/**
 * The campaign create both surfaces share: POST, refresh the campaign list,
 * open the new campaign.
 *
 * The invalidation happens BEFORE the navigation on purpose — the switcher and
 * the new campaign's own header read that list, so a chapter overview mounting
 * off a list that does not know the campaign yet would render without its
 * name.
 *
 * `replace` is the difference between the two: the cold start replaces "/"
 * (the redirect must not sit in the history, or "back" would bounce forward
 * again), while switching campaigns from the topbar is a normal step.
 */
export function useCampaignCreate({ replace = false }: { replace?: boolean } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async (input: CampaignCreateInput) => {
    const campaign = await createCampaign(input);
    await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    await navigate(campaignHref(campaign.id), { replace });
    return campaign;
  };
}

/**
 * Campaign create on a running instance — opened from the topbar switcher,
 * which is where the question "and where is the second campaign?" comes up.
 * The dialog only differs from the cold-start page in being a dialog; the
 * fields, the id preview and the 409 branch are the shared ones.
 */
export function CampaignCreateDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const createCampaignFlow = useCampaignCreate();
  return (
    <CreateDialog
      title={t("create.campaign.title")}
      nameLabel={t("create.campaign.nameLabel")}
      namePlaceholder={t("create.campaign.namePlaceholder")}
      addressPrefix={t("create.campaign.idPrefix")}
      extra={{
        label: t("create.campaign.descriptionLabel"),
        placeholder: t("create.campaign.descriptionPlaceholder"),
        multiline: true,
      }}
      create={async (values: CreateValues) => {
        await createCampaignFlow({
          name: values.name,
          ...(values.extra === undefined ? {} : { description: values.extra }),
          ...(values.id === undefined ? {} : { id: values.id }),
        });
        onClose();
      }}
      onClose={onClose}
    />
  );
}
