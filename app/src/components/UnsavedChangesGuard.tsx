// The "discard changes?" question for views whose save is EXPLICIT.
//
// The campaign-content pages (components/EditableList.tsx) edit a row inline
// and save it with a button, which means there is a window in which the DM's
// work lives only in the page. Leaving it — the back row, the campaign
// switcher, the browser's back button, a reload — would throw that work away
// without a word. That is the same silent loss decisions/writes forbids on the write
// path, just on the way out instead of on the way in, and the app already has
// the answer for it: the dialogs' discard confirmation
// (components/fields/FieldsDialog.tsx). This is that confirmation, for
// navigation.
//
// TWO EXITS, two mechanisms, because a page cannot guard both with one:
//
//   * inside the app it is react-router's `useBlocker` — a real dialog with
//     the app's own copy, and "keep editing" leaves the DM exactly where
//     they were;
//   * out of the app (reload, closing the tab, a foreign link) only
//     `beforeunload` exists, and the browser writes that text itself. It is
//     registered ONLY while something is actually dirty: an unconditional
//     handler makes every reload of a clean page ask, which trains everyone
//     to click through it.
//
// WHY A PROVIDER and not a hook per editor: `useBlocker` is one blocker per
// router, and a page may carry more than one editor. So the editors only
// report whether they are dirty (`useUnsavedChanges`) and the page owns the
// one blocker and the one dialog — which is also the honest UX, since "you
// have unsaved changes" is a statement about the PAGE, not about one list.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

interface GuardApi {
  /** One editor reports its state. `false` (or unmounting) releases it. */
  setDirty: (id: string, dirty: boolean) => void;
}

const GuardContext = createContext<GuardApi | undefined>(undefined);

/**
 * Report from inside an editor whether it holds unsaved changes. A no-op
 * without a provider above it, so an editor stays usable anywhere.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const guard = useContext(GuardContext);
  const id = useId();
  useEffect(() => {
    if (guard === undefined) return;
    guard.setDirty(id, dirty);
    return () => guard.setDirty(id, false);
  }, [guard, id, dirty]);
}

export function UnsavedChangesGuard({ children }: { children: ReactNode }) {
  const t = useT();
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const api = useMemo<GuardApi>(() => ({ setDirty }), [setDirty]);
  const dirty = dirtyIds.size > 0;

  // Any change of LOCATION counts, the query string included: `?from=` is
  // which campaign the page is about, so switching it leaves this list just
  // as much as leaving the page does.
  const shouldBlock = useCallback(
    ({
      currentLocation,
      nextLocation,
    }: {
      currentLocation: { pathname: string; search: string };
      nextLocation: { pathname: string; search: string };
    }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // `preventDefault` is the standard way; `returnValue` is what older
      // engines still look at. The browser writes the wording, not us.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <GuardContext.Provider value={api}>
      {children}
      {blocker.state === "blocked" && (
        <Dialog
          open
          onOpenChange={(open) => {
            // Escape and the backdrop mean "keep editing": the safe
            // choice is the one a stray keystroke may not skip past.
            if (!open) blocker.reset();
          }}
        >
          <DialogContent className="max-w-[420px]">
            <DialogTitle>{t("properties.discard.title")}</DialogTitle>
            <DialogDescription>{t("unsaved.description")}</DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  {t("properties.discard.keepEditing")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => blocker.proceed()}
                className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
              >
                {t("common.discard")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </GuardContext.Provider>
  );
}
