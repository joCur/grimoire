// The live mode's detail drawer (issue #40): the full NPC or location file
// WITHOUT leaving the running session.
//
// Before this, an NPC card in the live aside was a link — one click and the
// DM was on the reading route, having lost the selected scene and whatever
// was half-typed in the Schnellnotiz. The drawer keeps the live route mounted
// (so both survive) and renders the very same article pipeline the reading
// view uses (EntityArticle → Markdown → callouts), so what the DM reads here
// is what the entry says. „Eintrag öffnen" is the deliberate way OUT into the
// full view, for when the drawer is not enough.
//
// No animation (ui/sheet.tsx): the quality floor asks for reduced-motion
// safety, and mid-sentence a panel that is simply there is the calm answer.

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { fetchFile } from "@/api";
import { EntityArticle } from "@/components/EntityArticle";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { fmString } from "@/lib/frontmatter";

export function LiveEntityDrawer({
  campaign,
  path,
  onClose,
}: {
  campaign: string;
  /** Campaign-relative file path, or undefined while the drawer is closed. */
  path: string | undefined;
  onClose: () => void;
}) {
  const open = path !== undefined;
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open && (
        <SheetContent
          aria-describedby={undefined}
          // The article carries the visible title; the accessible name of the
          // dialog comes from the hidden SheetTitle inside.
          className="gap-0"
        >
          <DrawerBody campaign={campaign} path={path} />
        </SheetContent>
      )}
    </Sheet>
  );
}

function DrawerBody({ campaign, path }: { campaign: string; path: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    retry: false,
  });

  const name =
    data === undefined
      ? path
      : (fmString(data.frontmatter.name) ?? fmString(data.frontmatter.title) ?? path);

  return (
    <>
      <SheetTitle className="sr-only">{name}</SheetTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10 md:px-8">
        {isPending && <p className="text-[13px] text-muted-foreground">Lade Details …</p>}
        {isError && (
          <p className="text-[13px] text-muted-foreground">
            Nicht ladbar — <span className="font-mono">{path}</span> prüfen.
          </p>
        )}
        {data !== undefined && <EntityArticle file={data} />}
      </div>
      <div className="flex-none border-t border-border px-6 py-3 md:px-8">
        <Link
          to={`/${campaign}/file/${path}`}
          className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-primary hover:text-primary-hover"
        >
          <ExternalLink aria-hidden size={14} className="flex-none" />
          Eintrag öffnen
        </Link>
      </div>
    </>
  );
}
