// The live mode's detail drawer: the full NPC or location WITHOUT leaving the
// running session.
//
// An NPC card in the live aside is not a link: one click would land on the
// reading route, losing the selected scene and whatever was half-typed in
// the quick note. The drawer keeps the live route mounted
// (so both survive) and renders the very same article pipeline the reading
// view uses (NpcArticle for an npc, LocationArticle for a location, the
// EntityArticle for the rest → Markdown → callouts), so what the DM reads
// here is what the row says. The link to the
// reading view is the deliberate way OUT, for when the drawer is not enough.
//
// No animation (ui/sheet.tsx): the quality floor asks for reduced-motion
// safety, and mid-sentence a panel that is simply there is the calm answer.

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { fetchEntry, fetchLocation, fetchNpc } from "@/api";
import { EntityArticle } from "@/components/EntityArticle";
import { LocationArticle } from "@/components/LocationArticle";
import { NpcArticle } from "@/components/NpcArticle";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/i18n";
import { openTargetHref, type OpenTarget } from "@/lib/open-target";
import { propString } from "@/lib/properties";
import { locationKey } from "@/lib/use-location-edit";
import { npcKey } from "@/lib/use-npc-edit";
import { PREVIEW_BOUNDARY_ATTR } from "@/markdown/ref-preview";

export function LiveEntityDrawer({
  campaign,
  target,
  onClose,
}: {
  campaign: string;
  /** What the drawer shows, or undefined while it is closed. */
  target: OpenTarget | undefined;
  onClose: () => void;
}) {
  const open = target !== undefined;
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open && (
        <SheetContent
          aria-describedby={undefined}
          // The article carries the visible title; the accessible name of the
          // dialog comes from the hidden SheetTitle inside.
          className="gap-0"
          // A reference's hover preview stays inside the drawer, not merely
          // inside the text column of the article in it.
          {...{ [PREVIEW_BOUNDARY_ATTR]: "" }}
        >
          {target.kind === "npc" ? (
            <NpcDrawerBody campaign={campaign} id={target.id} />
          ) : target.kind === "location" ? (
            <LocationDrawerBody campaign={campaign} id={target.id} />
          ) : (
            <EntryDrawerBody campaign={campaign} path={target.path} />
          )}
        </SheetContent>
      )}
    </Sheet>
  );
}

function EntryDrawerBody({ campaign, path }: { campaign: string; path: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    retry: false,
  });
  const name =
    data === undefined
      ? path
      : (propString(data.properties.name) ?? propString(data.properties.title) ?? path);
  return (
    <DrawerFrame
      campaign={campaign}
      target={{ kind: "entry", path }}
      name={name}
      isPending={isPending}
      isError={isError}
    >
      {data !== undefined && <EntityArticle entry={data} />}
    </DrawerFrame>
  );
}

function NpcDrawerBody({ campaign, id }: { campaign: string; id: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: npcKey(campaign, id),
    queryFn: () => fetchNpc(campaign, id),
    retry: false,
  });
  return (
    <DrawerFrame
      campaign={campaign}
      target={{ kind: "npc", id }}
      name={data === undefined || data.name === "" ? id : data.name}
      isPending={isPending}
      isError={isError}
    >
      {data !== undefined && <NpcArticle npc={data} />}
    </DrawerFrame>
  );
}

function LocationDrawerBody({ campaign, id }: { campaign: string; id: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: locationKey(campaign, id),
    queryFn: () => fetchLocation(campaign, id),
    retry: false,
  });
  return (
    <DrawerFrame
      campaign={campaign}
      target={{ kind: "location", id }}
      name={data?.name ?? id}
      isPending={isPending}
      isError={isError}
    >
      {data !== undefined && <LocationArticle location={data} />}
    </DrawerFrame>
  );
}

/** The drawer around one article: its hidden title, the states, the way out. */
function DrawerFrame({
  campaign,
  target,
  name,
  isPending,
  isError,
  children,
}: {
  campaign: string;
  target: OpenTarget;
  name: string;
  isPending: boolean;
  isError: boolean;
  children: ReactNode;
}) {
  const { t, tNode } = useI18n();
  const shown = target.kind === "entry" ? target.path : target.id;
  return (
    <>
      <SheetTitle className="sr-only">{name}</SheetTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10 md:px-8">
        {isPending && (
          <p className="text-[13px] text-muted-foreground">{t("live.drawer.loading")}</p>
        )}
        {isError && (
          <p className="text-[13px] text-muted-foreground">
            {/* The monospaced name sits INSIDE the sentence, so the message is
                formatted to parts instead of glued together from two halves. */}
            {tNode("live.drawer.unloadable", {
              path: (
                <span key="path" className="font-mono">
                  {shown}
                </span>
              ),
            })}
          </p>
        )}
        {children}
      </div>
      <div className="flex-none border-t border-border px-6 py-3 md:px-8">
        <Link
          to={openTargetHref(campaign, target)}
          className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-primary hover:text-primary-hover"
        >
          <ExternalLink aria-hidden size={14} className="flex-none" />
          {t("live.drawer.open")}
        </Link>
      </div>
    </>
  );
}
