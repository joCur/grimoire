// „id ändern" — the rename dialog (issue #30), reached from the footer of the
// „Eigenschaften" dialog since issue #77. It has no header trigger of its own
// any more: with `[[slug]]` references resolving the CURRENT name (#68),
// changing the id is a repair (a typo, a slug merge), not everyday work — so
// it sits as a quiet secondary action next to the fields it does not own,
// while „name" is edited in the form like any other property.
//
// An id is a reference key, so renaming it is never a one-entry edit — it is a
// cascade through scene properties, session logs and relationship lists. The
// DM must SEE that before it happens, which is why the dialog has two steps:
//
//   1. new id -> „Vorschau" (a dryRun of the endpoint: the server computes
//      the whole plan and writes nothing),
//   2. the usage summary („12 Verwendungen: 3 Szenen, 2 Beziehungen …",
//      issue #60) plus „betrifft N Einträge" and the entry list ->
//      „Umbenennen" commits.
//
// The preview is the same code path as the commit, so a preview that
// succeeded is a rename that will succeed. Editing the id after a preview
// drops the plan — a stale entry list would be a lie.
//
// After the write the reading view follows the entry to its new path and the
// campaign's tree/entry/search queries are invalidated (paths and ids moved).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { renameEntity, type RenameResult } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import {
  canSubmitNewId,
  changedCountLabel,
  newIdError,
  renameErrorMessage,
  renameKindLabel,
  renamedPath,
  usageSummary,
  usageTotalLabel,
  type RenameTarget,
} from "@/lib/rename";

/**
 * The rename dialog itself — mounted only while open, by whoever offers the
 * action (today: the „Eigenschaften" dialog's footer, issue #77).
 */
export function RenameDialog({
  campaign,
  currentPath,
  target,
  onClose,
}: {
  campaign: string;
  /** The path of the entry on screen — where the view has to follow to. */
  currentPath: string;
  target: RenameTarget;
  onClose: () => void;
}) {
  const { t, tNode } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newId, setNewId] = useState("");
  const [plan, setPlan] = useState<RenameResult>();
  const [message, setMessage] = useState<string>();

  const trimmed = newId.trim();
  const ruleError = newIdError(newId, target.oldId, t);
  const canSubmit = canSubmitNewId(newId, target.oldId);

  const preview = useMutation({
    mutationFn: (id: string) =>
      renameEntity(campaign, { kind: target.kind, oldId: target.oldId, newId: id, dryRun: true }),
    onSuccess: (result) => setPlan(result),
    onError: (error) => setMessage(renameErrorMessage(error, t)),
  });

  const commit = useMutation({
    mutationFn: (id: string) =>
      renameEntity(campaign, { kind: target.kind, oldId: target.oldId, newId: id }),
    onSuccess: (result) => {
      // Follow the entry to its new path FIRST — the view must not sit on a
      // path that no longer exists while the caches are being refreshed.
      onClose();
      void navigate(`/${campaign}/entry/${renamedPath(currentPath, result.renamed)}`);
      // Ids and paths moved, so the tree and the search results are stale …
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: ["search", campaign] });
      // … and so is every entry the cascade rewrote. Invalidated by EXACT key,
      // deliberately: a prefix invalidation would also hit the entry we just
      // navigated away from and refetch a path that no longer exists.
      for (const changed of result.changed) {
        void queryClient.invalidateQueries({ queryKey: ["entry", campaign, changed] });
      }
    },
    onError: (error) => setMessage(renameErrorMessage(error, t)),
  });

  const pending = preview.isPending || commit.isPending;

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[460px]">
        <DialogTitle>
          {t("rename.title", { kind: renameKindLabel(target.kind, t) })}
        </DialogTitle>
        <DialogDescription>{t("rename.description")}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || pending) return;
            setMessage(undefined);
            if (plan === undefined) preview.mutate(trimmed);
            else commit.mutate(trimmed);
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">
              {/* The current id sits INSIDE the sentence and is monospaced, so
                  the message is formatted to PARTS rather than pasted together
                  from two half sentences (i18n/format.ts). */}
              {tNode("rename.newId.label", {
                oldId: (
                  <span key="old" className="font-mono">
                    {target.oldId}
                  </span>
                ),
              })}
            </span>
            <input
              // Radix focuses the first focusable element on open — this input.
              value={newId}
              onChange={(e) => {
                setNewId(e.target.value);
                // A plan belongs to exactly one id.
                setPlan(undefined);
                setMessage(undefined);
              }}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={ruleError !== undefined}
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 font-mono text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
              placeholder={target.oldId}
            />
          </label>

          {plan !== undefined && <RenamePlanPreview plan={plan} />}

          <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {ruleError ?? message ?? ""}
          </p>

          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit || pending}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {t(
                plan === undefined
                  ? preview.isPending
                    ? "rename.previewing"
                    : "rename.preview"
                  : commit.isPending
                    ? "rename.committing"
                    : "rename.commit",
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dry run's plan: the move, the USAGE summary (issue #60 — what hangs off
 * the id, counted by the same queries the cascade rewrites), the entry count
 * and every entry it touches.
 */
function RenamePlanPreview({ plan }: { plan: RenameResult }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-input bg-panel-deep px-3 py-2.5">
      <p className="text-[12px] text-body-secondary">
        <span className="font-mono text-[11.5px] text-soft">{plan.renamed.from}</span>
        {" → "}
        <span className="font-mono text-[11.5px] text-foreground">{plan.renamed.to}</span>
      </p>
      <p className="mt-2 text-[12px] text-body" data-testid="rename-usage">
        {plan.usage.total > 0 && (
          <span className="font-semibold text-body">
            {usageTotalLabel(plan.usage.total, t)}
            {": "}
          </span>
        )}
        <span className="text-body-secondary">{usageSummary(plan.usage, t)}</span>
      </p>
      <p className="mt-2 text-[12px] font-semibold text-body">
        {changedCountLabel(plan.changed.length, t)}
      </p>
      <ul className="mt-1 max-h-[160px] overflow-y-auto">
        {plan.changed.map((file) => (
          <li key={file} className="font-mono text-[11.5px] leading-[1.7] break-all text-muted-foreground">
            {file}
          </li>
        ))}
      </ul>
    </div>
  );
}
