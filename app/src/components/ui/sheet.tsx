// Sheet primitive (shadcn/ui shape, Grimoire tokens) on top of Radix Dialog —
// a panel that slides in from the right edge instead of a centered modal.
// Focus trap, Esc, outside click and aria-modal come from the primitive.
//
// ONLY SheetContent is its own thing: the panel geometry. Root, Title and
// Description are the dialog's (./dialog) under sheet names — they were
// byte-identical copies before, which is one styling decision in two files.
//
// Like ./dialog there is NO enter/leave animation: the quality floor asks for
// prefers-reduced-motion safety, and in the live mode (issue #40 — the NPC and
// location drawer) a panel that is simply THERE is the calmer answer while the
// DM is mid-sentence. The panel scrolls internally, so a long NPC file never
// pushes the live layout around.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const Sheet = Dialog;
const SheetTitle = DialogTitle;

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-0 right-0 bottom-0 z-50 flex w-[calc(100vw-24px)] max-w-[560px] flex-col border-l border-border bg-card shadow-[-24px_0_60px_rgba(0,0,0,.45)]",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Close
          aria-label="Schließen"
          className="absolute top-3.5 right-4 z-10 rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden size={16} />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetContent, SheetTitle };
