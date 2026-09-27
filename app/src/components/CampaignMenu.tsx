// The campaign menu: the ONE entry point into every area of a campaign
// (lib/areas.ts). It sits where the campaign switcher always sat, and closed
// it says where the DM is — the campaign, and after it the current area; on a
// view with no area only the campaign. Opened it lists the campaigns (switch,
// create) and the campaign's areas in their groups, the current one marked.
// ⌘K reaches the same areas from the same list.
//
// One menu, two shapes: from `md` up a dropdown under the trigger, keyboard
// driven by the primitive (arrow keys, Enter, Escape, typeahead); on a phone a
// sheet from the bottom edge, within thumb reach. The breakpoint decides which
// component renders, so it is a media query, not a class.
//
// The session review's entry carries how many rows are still open while
// there are any — the only place that count is shown outside the review
// itself.
//
// Creating a campaign lives here too: the cold start covers the first one,
// and without this entry a second campaign would have no way into the UI.

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import { fetchCampaigns } from "@/api";
import { CampaignCreateDialog } from "@/campaign/CampaignCreate";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { AREA_GROUPS, areasOf, currentArea, type Area } from "@/lib/areas";
import { campaignDescription, campaignLabel } from "@/lib/campaign";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { useReviewCards } from "@/lib/use-review";

const GROUP_HEADING =
  "px-2.5 pt-0.5 pb-1.5 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase";

export function CampaignMenu({ campaign }: { campaign: string }) {
  const t = useT();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { pathname } = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });
  const name = campaignLabel(
    (data ?? []).find((c) => c.id === campaign),
    campaign,
  );
  // Route-derived, so the marking never lags behind a query.
  const area = currentArea(pathname);
  const areaLabel = area === undefined ? undefined : t(area.label);
  const pending = useReviewPending(campaign);
  const triggerName =
    areaLabel === undefined
      ? t("campaignMenu.trigger", { name })
      : t("campaignMenu.triggerInArea", { name, area: areaLabel });

  const trigger = (
    <>
      <span
        className={cn(
          "min-w-0 truncate",
          // From md up the trigger is the anchor of the topbar and its width
          // must not depend on what the right side carries, so the name gets
          // a static cap per breakpoint and truncates within it; the area
          // after it never truncates. The full name is one click away in the
          // menu. On the phone the trigger takes the width it is given.
          desktop && "max-w-[7rem] lg:max-w-[10rem] xl:max-w-[160px] 2xl:max-w-[280px]",
        )}
      >
        {name}
      </span>
      {areaLabel !== undefined && (
        <>
          <ChevronRight aria-hidden size={12} className="flex-none text-faint" />
          <span className="flex-none text-foreground">{areaLabel}</span>
        </>
      )}
      <ChevronDown aria-hidden size={14} className="flex-none text-muted-foreground" />
    </>
  );
  const createDialog = createOpen && <CampaignCreateDialog onClose={() => setCreateOpen(false)} />;

  if (!desktop) {
    return (
      <MenuSheet
        campaign={campaign}
        campaigns={data}
        current={area}
        pending={pending}
        triggerName={triggerName}
        trigger={trigger}
        onCreate={() => setCreateOpen(true)}
      >
        {createDialog}
      </MenuSheet>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={triggerName}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "h-auto min-w-0 flex-none gap-[7px] rounded-md border border-transparent px-2.5 py-[5px] text-[13px] font-normal text-body-secondary hover:border-input hover:bg-transparent hover:text-foreground data-[state=open]:border-input",
        )}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // Two panes: the campaigns on the left, the areas in their groups on
        // the right. Arrow keys walk them in reading order.
        className="grid max-w-[calc(100vw-32px)] grid-cols-[220px_auto] gap-0 p-0"
      >
        <DropdownMenuGroup
          aria-label={t("campaignMenu.campaigns")}
          className="border-r border-border bg-panel-deep p-1.5"
        >
          <DropdownMenuLabel aria-hidden className={GROUP_HEADING}>{t("campaignMenu.campaigns")}</DropdownMenuLabel>
          {(data ?? []).map((c) => (
            <DropdownMenuItem asChild key={c.id}>
              <Link to={`/campaigns/${c.id}`} className="items-start">
                <CampaignRow name={campaignLabel(c, c.id)} description={campaignDescription(c)} current={c.id === campaign} />
              </Link>
            </DropdownMenuItem>
          ))}
          {data !== undefined && data.length === 0 && (
            <p className="px-2.5 py-[9px] text-[13px] text-muted-foreground">{t("campaignMenu.empty")}</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            // The dialog must not mount inside the menu: Radix unmounts the
            // content on select, which would take the dialog with it.
            onSelect={() => setCreateOpen(true)}
            className="gap-2 text-[13px] text-body-secondary"
          >
            <Plus aria-hidden size={13} className="flex-none text-muted-foreground" />
            {t("create.campaign.title")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <div className="grid grid-cols-[repeat(3,minmax(9.5rem,max-content))] gap-x-2 p-1.5">
          {AREA_GROUPS.map((group) => (
            <DropdownMenuGroup key={group.id} aria-label={t(group.label)}>
              <DropdownMenuLabel aria-hidden className={GROUP_HEADING}>{t(group.label)}</DropdownMenuLabel>
              {areasOf(group.id).map((entry) => (
                <DropdownMenuItem asChild key={entry.id}>
                  <AreaLink
                    campaign={campaign}
                    area={entry}
                    current={entry.id === area?.id}
                    pending={pending}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </div>
      </DropdownMenuContent>
      {createDialog}
    </DropdownMenu>
  );
}

/** The phone's shape of the menu: the same trigger, the same lists, in a sheet. */
function MenuSheet({
  campaign,
  campaigns,
  current,
  pending,
  triggerName,
  trigger,
  onCreate,
  children,
}: {
  campaign: string;
  campaigns: Awaited<ReturnType<typeof fetchCampaigns>> | undefined;
  current: Area | undefined;
  pending: number;
  triggerName: string;
  trigger: React.ReactNode;
  onCreate: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={triggerName}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[14px] text-body-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {trigger}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetTitle className="sr-only">{t("campaignMenu.title")}</SheetTitle>
          <div className="flex min-h-0 flex-col overflow-y-auto">
            <p aria-hidden className={GROUP_HEADING}>
              {t("campaignMenu.campaigns")}
            </p>
            {(campaigns ?? []).map((c) => (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-2.5 rounded-[7px] px-2.5 py-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <CampaignRow name={campaignLabel(c, c.id)} description={undefined} current={c.id === campaign} />
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="flex min-h-11 items-center gap-2 rounded-[7px] px-2.5 text-left text-[14px] text-body-secondary hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Plus aria-hidden size={14} className="flex-none text-muted-foreground" />
              {t("create.campaign.title")}
            </button>
            {AREA_GROUPS.map((group) => (
              <div key={group.id} role="group" aria-label={t(group.label)} className="mt-3 border-t border-divider pt-3">
                <p aria-hidden className={GROUP_HEADING}>
                  {t(group.label)}
                </p>
                <div className="grid grid-cols-2 gap-x-2">
                  {areasOf(group.id).map((entry) => (
                    <AreaLink
                      key={entry.id}
                      campaign={campaign}
                      area={entry}
                      current={entry.id === current?.id}
                      pending={pending}
                      onClick={() => setOpen(false)}
                      className="min-h-11 text-[15px]"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      {children}
    </>
  );
}

/** A campaign of the list: its name, its description under it, a check on the current one. */
function CampaignRow({
  name,
  description,
  current,
}: {
  name: string;
  description: string | undefined;
  current: boolean;
}) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-foreground">{name}</span>
        {description !== undefined && (
          <span className="mt-px line-clamp-2 block text-[11.5px] leading-[1.4] text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {current && <Check aria-hidden size={13} className="mt-1 flex-none text-success-text" />}
    </>
  );
}

/**
 * One area of the menu. The current one carries `aria-current` and a brass
 * bar at its edge; the session review carries its open count.
 */
function AreaLink({
  campaign,
  area,
  current,
  pending,
  className,
  ...props
}: {
  campaign: string;
  area: Area;
  current: boolean;
  /** What the session review still has open. */
  pending: number;
} & Omit<React.ComponentProps<typeof Link>, "to">) {
  const t = useT();
  const Icon = area.icon;
  return (
    <Link
      to={area.href(campaign)}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-[13.5px] text-body-secondary outline-none hover:bg-secondary focus:bg-secondary focus-visible:ring-2 focus-visible:ring-ring",
        current &&
          "bg-primary/10 text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden size={15} className={cn("flex-none", current ? "text-primary" : "text-muted-foreground")} />
      {/* On the phone the count goes under the label: half the sheet's
          width has no room for both on one line. */}
      <span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-2.5">
        <span className="min-w-0 md:flex-1 md:whitespace-nowrap">{t(area.label)}</span>
        {area.id === "review" && pending > 0 && (
          <span className="flex-none font-mono text-[11.5px] text-muted-foreground">
            {t("campaignMenu.reviewPending", { count: pending })}
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * How many rows the session review still has open — asked with the trigger,
 * not with the opened menu, so the count is there the moment it opens. The
 * review page and the menu share the query cache.
 */
function useReviewPending(campaign: string): number {
  const review = useReviewCards(campaign);
  return review.isPending || review.noSession || review.isError ? 0 : review.pendingCount;
}
