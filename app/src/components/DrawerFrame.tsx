// The live drawer around one article: its hidden title, the loading and
// failure lines, and the link to the reading view — the deliberate way OUT,
// for when the drawer is not enough. What the article is, is the caller's.

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/i18n";

export function DrawerFrame({
  href,
  shown,
  name,
  isPending,
  isError,
  children,
}: {
  /** The reading view of what the drawer shows. */
  href: string;
  /** How the failure line names it — its id or its address. */
  shown: string;
  /** The accessible name of the drawer. */
  name: string;
  isPending: boolean;
  isError: boolean;
  children: ReactNode;
}) {
  const { t, tNode } = useI18n();
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
          to={href}
          className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-primary hover:text-primary-hover"
        >
          <ExternalLink aria-hidden size={14} className="flex-none" />
          {t("live.drawer.open")}
        </Link>
      </div>
    </>
  );
}
