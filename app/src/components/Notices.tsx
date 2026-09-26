// Short notices at the bottom of the screen that do not block anything: a
// sentence, and at most one action beside it — the undo of what the DM just
// did. A UI building block without knowledge of entities: the caller brings
// the sentence, the action's label and what the action does.
//
// Built on `sonner` (decisions/dependencies). The host is mounted once in the
// app's layout; `showUndoNotice` and `showNotice` can be called from any
// event handler. A notice pauses while hovered or focused and while the tab
// is hidden, is announced politely to a screen reader, and loses its motion
// under `prefers-reduced-motion` (sonner's own stylesheet does that). It
// sits at the bottom centre, away from the live view's quick note on the
// right.

import { toast, Toaster } from "sonner";

import { useT } from "@/i18n";

/** How long a notice with an undo action stays — long enough to read and reach it. */
const UNDO_DURATION_MS = 8_000;

/** The one place notices appear. Mount once, inside the i18n provider. */
export function NoticeHost() {
  const t = useT();
  return (
    <Toaster
      position="bottom-center"
      containerAriaLabel={t("notice.region")}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-lg border border-input bg-popover px-4 py-3 text-[13.5px] leading-[1.5] text-foreground shadow-lg",
          title: "min-w-0 flex-1",
          actionButton:
            "flex-none rounded-md px-2.5 py-1 text-[13px] font-semibold text-primary hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        },
      }}
    />
  );
}

/**
 * A notice that says what just happened and offers to undo it. `onUndo` runs
 * once, when the DM takes the action; the notice closes with it.
 */
export function showUndoNotice(input: {
  message: string;
  undoLabel: string;
  onUndo: () => void;
}): void {
  toast(input.message, {
    duration: UNDO_DURATION_MS,
    action: { label: input.undoLabel, onClick: input.onUndo },
  });
}

/** A notice that only says something — the outcome of an undo, for one. */
export function showNotice(message: string): void {
  toast(message);
}
