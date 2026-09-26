// What a proposed scene is missing when it names an npc or a location of its
// run that the DM rejected (decisions/generator): one whole sentence per
// missing proposal, and the three ways out — accept the proposal after all,
// take the reference out of the scene, or drop the scene. It sits in the
// notice slot of the scene's card; the writes are the caller's.

import type { GeneratorJob } from "@grimoire/shared/generator-job";
import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

const ACTION =
  "h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground";

export function SceneReferenceNotice({
  job,
  missing,
  busy,
  onAccept,
  onRemove,
  onDrop,
}: {
  job: GeneratorJob;
  /** The rejected proposals the scene names (`rejectedReferences`). */
  missing: { npcs: string[]; locations: string[] };
  busy: boolean;
  onAccept: (kind: "npc" | "location", id: string) => void;
  onRemove: (kind: "npc" | "location", id: string) => void;
  onDrop: () => void;
}) {
  const t = useT();
  const npcName = (id: string) => job.result?.npcs.find((npc) => npc.id === id)?.name || id;
  const locationName = (id: string) =>
    job.result?.locations.find((location) => location.id === id)?.name || id;
  const rows = [
    ...missing.locations.map((id) => ({ kind: "location" as const, id, name: locationName(id) })),
    ...missing.npcs.map((id) => ({ kind: "npc" as const, id, name: npcName(id) })),
  ];
  if (rows.length === 0) return null;
  return (
    <div
      data-testid="scene-incomplete"
      className="mt-3.5 rounded-md border border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)] px-3.5 py-3"
    >
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={`${row.kind}:${row.id}`} data-testid={`scene-incomplete:${row.kind}:${row.id}`}>
            <p className="flex items-start gap-2 text-[13px] leading-[1.55] text-foreground">
              <CircleAlert aria-hidden size={15} className="mt-[3px] flex-none text-destructive" />
              {t(
                row.kind === "npc" ? "generate.incomplete.npc" : "generate.incomplete.location",
                { name: row.name },
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 pl-[23px]">
              <Button
                type="button"
                variant="outline"
                data-testid="scene-incomplete-accept"
                disabled={busy}
                onClick={() => onAccept(row.kind, row.id)}
                className={ACTION}
              >
                {t(
                  row.kind === "npc"
                    ? "generate.incomplete.acceptNpc"
                    : "generate.incomplete.acceptLocation",
                  { name: row.name },
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="scene-incomplete-remove"
                disabled={busy}
                onClick={() => onRemove(row.kind, row.id)}
                className={ACTION}
              >
                {row.kind === "npc"
                  ? t("generate.incomplete.removeNpc", { name: row.name })
                  : t("generate.incomplete.removeLocation")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 pl-[23px]">
        <Button
          type="button"
          variant="outline"
          data-testid="scene-incomplete-drop"
          disabled={busy}
          onClick={onDrop}
          className={ACTION}
        >
          {t("generate.incomplete.drop")}
        </Button>
      </div>
    </div>
  );
}
