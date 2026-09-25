// The scene-status control: the status display itself becomes the control.
// Two densities, one menu — the pill in the scene reading view and the bare
// dot+label of a chapter overview row; both keep the quiet look and only grow
// a small chevron on hover/focus.
//
// The write needs the rev of the scene it is changing. The reading view has
// the scene on screen and hands its rev down; a chapter overview row has only
// the tree (which carries no rev), so the control fetches the scene LAZILY
// when the menu opens — one GET, shared with the scene's query cache.
//
// While a write runs the trigger shows the TARGET value dimmed. That is a
// display state only: the query cache is never written with a guessed value,
// it always gets the scene the server sent back.

import type { SceneStatus } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusMenu, type StatusVariant } from "@/components/StatusMenu";
import { useT } from "@/i18n";

import { sceneQuery } from "./scene-query";
import { sceneStatusMeta, sceneStatusOptions } from "./scene-status";
import { useSceneStatusMutation } from "./use-scene-status";

/** "pill" = scene reading view (bordered pill), "row" = chapter overview list row. */
export type SceneStatusVariant = StatusVariant;

export function SceneStatusControl({
  campaign,
  id,
  status,
  rev,
  variant,
}: {
  campaign: string;
  id: string;
  /** The status as it stands in the tree or on the scene on screen. */
  status: SceneStatus;
  /** From the loaded scene; undefined means "fetch it when opening". */
  rev?: number | undefined;
  variant: SceneStatusVariant;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Lazy rev for the chapter overview rows: only ever requested once the menu
  // opens, and served from the cache when the scene was read before.
  const scene = useQuery({
    ...sceneQuery(campaign, id),
    enabled: open && rev === undefined && campaign !== "" && id !== "",
    retry: false,
  });
  const knownRev = rev ?? scene.data?.rev;
  const { setStatus, pendingStatus, message } = useSceneStatusMutation(campaign, id, knownRev);

  return (
    <SceneStatusMenu
      status={status}
      variant={variant}
      pendingStatus={pendingStatus}
      // A row whose scene could not be read at all cannot be patched — the
      // display stays, the menu just does nothing.
      disabled={scene.isError}
      message={message ?? (scene.isError ? t("status.sceneUnloadable") : undefined)}
      open={open}
      onOpenChange={setOpen}
      onSelect={setStatus}
    />
  );
}

/**
 * The presentation: trigger plus the four options with the current one
 * checked. Pure (no queries, no mutation) so it can be render-tested.
 *
 * The MARKUP is `components/StatusMenu`, which the chapter's control shares —
 * what stays here is the scene's own data: its four options, its label/color
 * table and its aria wording.
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
  status: SceneStatus;
  variant: SceneStatusVariant;
  pendingStatus?: SceneStatus | undefined;
  message?: string | undefined;
  disabled?: boolean;
  open?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
  onSelect: (status: SceneStatus) => void;
}) {
  const t = useT();
  return (
    <StatusMenu
      status={status}
      pendingStatus={pendingStatus}
      options={sceneStatusOptions(t)}
      meta={(value) => sceneStatusMeta(value, t)}
      ariaLabel={t("status.change.aria", { current: sceneStatusMeta(status, t).label })}
      variant={variant}
      message={message}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      onSelect={onSelect}
    />
  );
}
