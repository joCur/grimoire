// Sheet primitive (shadcn/ui shape, Grimoire tokens) on top of Radix Dialog —
// a panel that slides in from an edge instead of a centered modal. Focus trap,
// Esc, outside click and aria-modal come from the primitive.
//
// Two edges:
//
//   right   the drawer of the live mode (the NPC and location drawer): full
//           height, scrolls internally, so a long NPC text never pushes the
//           live layout around.
//   bottom  the phone's sheet: it rises from the bottom edge, within thumb
//           reach, as high as its content and never higher than most of the
//           screen. It has no close button of its own — the caller puts its
//           own "done" action at the bottom, and Esc and the backdrop close it.
//
// ONLY SheetContent is its own thing: the panel geometry. Root, Title and
// Description are the dialog's (./dialog) under sheet names — one styling
// decision in one module.
//
// Like ./dialog there is NO enter/leave animation: the quality floor asks for
// prefers-reduced-motion safety, and a panel that is simply THERE is the
// calmer answer while the DM is mid-sentence.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

const Sheet = Dialog;
const SheetTitle = DialogTitle;

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: "right" | "bottom" }) {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          side === "right"
            ? "fixed top-0 right-0 bottom-0 z-50 flex w-[calc(100vw-24px)] max-w-[560px] flex-col border-l border-border bg-card shadow-[-24px_0_60px_rgba(0,0,0,.45)]"
            : "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-input bg-popover px-4 pt-2.5 pb-5 shadow-popover",
          className,
        )}
        {...props}
      >
        {side === "right" ? (
          <DialogPrimitive.Close
            aria-label={t("common.close")}
            className="absolute top-3.5 right-4 z-10 rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden size={16} />
          </DialogPrimitive.Close>
        ) : (
          <span
            aria-hidden
            className="mb-2.5 h-1 w-9 flex-none self-center rounded-full bg-input"
          />
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetContent, SheetTitle };
