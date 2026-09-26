// The status control of an npc's edit mode: the status pill beside the
// heading turns into a menu over the four values. It writes nothing itself —
// the chosen value is part of the edit mode's one save, since every field of
// the npc shares one guard (decisions/writes). The markup is the shared
// components/StatusMenu; what stays here is the npc's own data.

import type { NpcStatus } from "@grimoire/shared/npc";

import { StatusMenu } from "@/components/StatusMenu";
import { useT } from "@/i18n";

import { npcStatusMeta, npcStatusOptions } from "./npc-status";

export function NpcStatusMenu({
  status,
  onSelect,
}: {
  status: NpcStatus;
  onSelect: (status: NpcStatus) => void;
}) {
  const t = useT();
  return (
    <StatusMenu
      status={status}
      options={npcStatusOptions(t)}
      meta={(value) => npcStatusMeta(value, t)}
      ariaLabel={t("status.change.aria", { current: npcStatusMeta(status, t).label })}
      variant="pill"
      onSelect={onSelect}
    />
  );
}
