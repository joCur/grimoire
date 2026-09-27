// The changes a scene run proposes for an npc or location the campaign
// already has (decisions/generator), in the notes slot of its row: what the
// model noted, what the server could not apply, and — while the extension is
// open — every change beside the row as the run read it, each taken or kept
// on its own. Accepting the row applies the taken ones to the row as it is
// stored then; what no longer applies there comes back as a finding of the
// part and stands here after the accept.
//
// The notes of an extension are not answered: its changes are decided as the
// model proposed them.

import type { GeneratorJobPart, PartChange } from "@grimoire/shared/generator-job";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { ModelNotes, NOTES_FRAME } from "./PartNotes";
import { ChangeRow, PartFindings } from "./PartRound";

export function ExtensionChanges({
  part,
  current,
  changes,
  kept,
  open,
  busy,
  onDecide,
}: {
  part: GeneratorJobPart;
  /** The row as the run read it — what each change is compared with. */
  current: Readonly<Record<string, unknown>>;
  changes: readonly PartChange[];
  /** The ids of the changes the DM keeps out. */
  kept: readonly string[];
  /** Still to decide: the changes can be taken or kept. */
  open: boolean;
  busy: boolean;
  onDecide: (id: string, take: boolean) => void;
}) {
  const t = useT();
  const findings = part.findings ?? [];
  const taken = changes.filter((change) => !kept.includes(change.id)).length;
  return (
    <>
      <ModelNotes warnings={part.warnings} serverNotes={part.serverNotes ?? []} title={part.title} />
      {findings.length > 0 && (
        <div className={cn("mb-3 px-3 py-2", NOTES_FRAME)}>
          <PartFindings kind={part.kind} findings={findings} t={t} />
        </div>
      )}
      {open && (
        <section
          data-testid="extension-changes"
          aria-label={t("generate.extension.changes", { count: changes.length })}
        >
          <p className="mb-2 text-[12.5px] text-body-secondary">
            {t("generate.extension.taken", { taken, count: changes.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {changes.map((change) => (
              <ChangeRow
                key={change.id}
                kind={part.kind}
                change={change}
                current={current}
                busy={busy}
                accepted={!kept.includes(change.id)}
                onDecide={(take) => onDecide(change.id, take)}
                t={t}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A finished extension that brought no change: the source adds nothing to the row. */
export function ExtensionUnchanged({
  part,
  cardRef,
}: {
  part: GeneratorJobPart;
  cardRef?: (el: HTMLElement | null) => void;
}) {
  const t = useT();
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      data-testid={`extension-unchanged:${part.id}`}
      className="mb-[18px] rounded-lg border border-border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <p className="mb-2 text-[13px] leading-[1.55] text-body-secondary">
        {t(part.kind === "npc" ? "generate.extension.unchanged.npc" : "generate.extension.unchanged.location", {
          name: part.title,
        })}
      </p>
      <ModelNotes warnings={part.warnings} serverNotes={part.serverNotes ?? []} title={part.title} />
      {(part.findings ?? []).length > 0 && (
        <div className={cn("px-3 py-2", NOTES_FRAME)}>
          <PartFindings kind={part.kind} findings={part.findings ?? []} t={t} />
        </div>
      )}
    </div>
  );
}
