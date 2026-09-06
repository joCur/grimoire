// „Umbenennen" in the reading view (issue #30).
//
// An id is a reference key, so renaming it is never a one-file edit — it is a
// cascade through scene frontmatter, session logs and relationship lists. The
// DM must SEE that before it happens, which is why the dialog has two steps:
//
//   1. new id -> „Vorschau" (a dryRun of the endpoint: the server computes
//      the whole plan and writes nothing),
//   2. the usage summary („12 Verwendungen: 3 Szenen, 2 Beziehungen …",
//      issue #60) plus „betrifft N Dateien" and the file list ->
//      „Umbenennen" commits.
//
// The preview is the same code path as the commit, so a preview that
// succeeded is a rename that will succeed. Editing the id after a preview
// drops the plan — a stale file list would be a lie.
//
// After the write the reading view follows the file to its new path and the
// campaign's tree/file/search queries are invalidated (paths and ids moved).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { renameEntity, type RenameResult } from "@/api";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * The quiet action next to an entity header. Renders nothing without a
 * renameable target (sessions, inbox, glossary, the campaign file).
 */
export function RenameAction({
  campaign,
  currentPath,
  target,
}: {
  campaign: string;
  /** The path of the file on screen — where the view has to follow to. */
  currentPath: string;
  target: RenameTarget | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (target === undefined) return null;

  return (
    <>
      <HeaderAction icon={PenLine} label="Umbenennen" onClick={() => setOpen(true)} />
      {open && (
        <RenameDialog
          campaign={campaign}
          currentPath={currentPath}
          target={target}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RenameDialog({
  campaign,
  currentPath,
  target,
  onClose,
}: {
  campaign: string;
  currentPath: string;
  target: RenameTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newId, setNewId] = useState("");
  const [plan, setPlan] = useState<RenameResult>();
  const [message, setMessage] = useState<string>();

  const trimmed = newId.trim();
  const ruleError = newIdError(newId, target.oldId);
  const canSubmit = canSubmitNewId(newId, target.oldId);

  const preview = useMutation({
    mutationFn: (id: string) =>
      renameEntity(campaign, { kind: target.kind, oldId: target.oldId, newId: id, dryRun: true }),
    onSuccess: (result) => setPlan(result),
    onError: (error) => setMessage(renameErrorMessage(error)),
  });

  const commit = useMutation({
    mutationFn: (id: string) =>
      renameEntity(campaign, { kind: target.kind, oldId: target.oldId, newId: id }),
    onSuccess: (result) => {
      // Follow the file to its new path FIRST — the view must not sit on a
      // path that no longer exists while the caches are being refreshed.
      onClose();
      void navigate(`/${campaign}/file/${renamedPath(currentPath, result.renamed)}`);
      // Ids and paths moved, so the tree and the search results are stale …
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: ["search", campaign] });
      // … and so is every file the cascade rewrote. Invalidated by EXACT key,
      // deliberately: a prefix invalidation would also hit the file we just
      // navigated away from and refetch a path that no longer exists.
      for (const changed of result.changed) {
        void queryClient.invalidateQueries({ queryKey: ["file", campaign, changed] });
      }
    },
    onError: (error) => setMessage(renameErrorMessage(error)),
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
        <DialogTitle>{renameKindLabel(target.kind)} umbenennen</DialogTitle>
        <DialogDescription>
          Die neue id zieht alle Referenzen mit: Eigenschaften, Session-Log und
          Beziehungslisten. Erwähnungen im Fließtext bleiben unverändert.
        </DialogDescription>

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
              neue id (aktuell <span className="font-mono">{target.oldId}</span>)
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
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit || pending}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {plan === undefined
                ? preview.isPending
                  ? "Prüfe …"
                  : "Vorschau"
                : commit.isPending
                  ? "Benenne um …"
                  : "Umbenennen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dry run's plan: the move, the USAGE summary (issue #60 — what hangs off
 * the id, counted by the same queries the cascade rewrites), the file count
 * and every file it touches.
 */
function RenamePlanPreview({ plan }: { plan: RenameResult }) {
  return (
    <div className="rounded-md border border-input bg-panel-deep px-3 py-2.5">
      <p className="text-[12px] text-body-secondary">
        <span className="font-mono text-[11.5px] text-soft">{plan.renamed.from}</span>
        {" → "}
        <span className="font-mono text-[11.5px] text-foreground">{plan.renamed.to}</span>
      </p>
      <p className="mt-2 text-[12px] text-body" data-testid="rename-usage">
        {plan.usage.total > 0 && (
          <span className="font-semibold text-body">{usageTotalLabel(plan.usage.total)}: </span>
        )}
        <span className="text-body-secondary">{usageSummary(plan.usage)}</span>
      </p>
      <p className="mt-2 text-[12px] font-semibold text-body">{changedCountLabel(plan.changed.length)}</p>
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
