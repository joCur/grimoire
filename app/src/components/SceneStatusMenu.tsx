// The scene-status control (issue #28): the status display itself becomes the
// regler. Two densities, one menu — the pill in the scene reading view and
// the bare dot+label of a pool row; both keep the quiet look and only grow a
// small chevron on hover/focus.
//
// The write needs the mtime of the file it is changing. The reading view has
// the FileResponse on screen and hands its mtime down; a pool row has only
// the tree (which carries no mtime), so the control fetches the file LAZILY
// when the menu opens — one GET, shared with the file query cache.
//
// While a write runs the trigger shows the TARGET value dimmed. That is a
// display state only: the query cache is never written with a guessed value,
// it always gets the file the server sent back.

import type { SceneStatus } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";

import { fetchFile } from "@/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SCENE_STATUS_OPTIONS, sceneStatusMeta } from "@/lib/scene-status";
import { useSceneStatusMutation } from "@/lib/use-scene-status";
import { cn } from "@/lib/utils";

/** "pill" = scene reading view (bordered pill), "row" = pool list row. */
export type SceneStatusVariant = "pill" | "row";

export function SceneStatusControl({
  campaign,
  path,
  status,
  mtimeMs,
  variant,
}: {
  campaign: string;
  path: string;
  /** The status as it stands in the file/tree — unknown values pass through. */
  status: string;
  /** From the loaded FileResponse; undefined means "fetch it when opening". */
  mtimeMs?: number | undefined;
  variant: SceneStatusVariant;
}) {
  const [open, setOpen] = useState(false);
  // Lazy mtime for the pool rows: only ever requested once the menu opens,
  // and served from the cache when the file was read before.
  const file = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    enabled: open && mtimeMs === undefined && campaign !== "" && path !== "",
    retry: false,
  });
  const knownMtime = mtimeMs ?? file.data?.mtimeMs;
  const { setStatus, pendingStatus, message } = useSceneStatusMutation(campaign, path, knownMtime);

  return (
    <SceneStatusMenu
      status={status}
      variant={variant}
      pendingStatus={pendingStatus}
      // A row whose file could not be read at all cannot be patched — the
      // display stays, the menu just does nothing.
      disabled={file.isError}
      message={message ?? (file.isError ? "Szene nicht ladbar" : undefined)}
      open={open}
      onOpenChange={setOpen}
      onSelect={setStatus}
    />
  );
}

/**
 * The presentation: trigger plus the four options with the current one
 * checked. Pure (no queries, no mutation) so it can be render-tested.
 */
export function SceneStatusMenu({
  status,
  variant,
  pendingStatus,
  message,
  disabled = false,
  open,
  onOpenChange,
  onSelect,
}: {
  status: string;
  variant: SceneStatusVariant;
  pendingStatus?: SceneStatus | undefined;
  message?: string | undefined;
  disabled?: boolean;
  open?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
  onSelect: (status: SceneStatus) => void;
}) {
  const pending = pendingStatus !== undefined;
  // Optimistic DISPLAY: the target value while the write is in flight.
  const shown = sceneStatusMeta(pendingStatus ?? status);
  const pill = variant === "pill";

  return (
    <span className="inline-flex flex-none flex-col items-end gap-0.5">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {/* The visible pill sits INSIDE the button, which reaches 8px further
            up and down (compensated by the negative margin): a finger-sized
            target on mobile without changing a single pixel of the layout. */}
        <DropdownMenuTrigger
          type="button"
          disabled={disabled}
          aria-label={`Status ändern, aktuell ${sceneStatusMeta(status).label}`}
          className="group -my-2 inline-flex items-center py-2 disabled:cursor-default"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full transition-colors",
              pill
                ? "border border-input px-[9px] py-px text-[11.5px] group-hover:border-border-hover"
                : "px-1 text-[12px] group-hover:bg-secondary",
            )}
          >
            <span aria-hidden className={cn("size-[7px] flex-none rounded-full", shown.dot)} />
            <span className={cn(shown.text, pending && "opacity-60")}>{shown.label}</span>
            <ChevronDown
              aria-hidden
              size={12}
              className={cn(
                "flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100",
                disabled && "hidden",
              )}
            />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px]">
          <DropdownMenuRadioGroup
            value={status}
            onValueChange={(value) => onSelect(value as SceneStatus)}
          >
            {SCENE_STATUS_OPTIONS.map((option) => {
              const meta = sceneStatusMeta(option.value);
              return (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="text-[13px] text-body-secondary"
                >
                  <span aria-hidden className={cn("size-[7px] flex-none rounded-full", meta.dot)} />
                  <span className="flex-1">{option.label}</span>
                  <span aria-hidden className="flex w-3.5 flex-none justify-center text-primary">
                    {option.value === status && <Check size={13} />}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {message !== undefined && (
        <span aria-live="polite" className="text-right text-[11.5px] text-muted-foreground">
          {message}
        </span>
      )}
    </span>
  );
}
