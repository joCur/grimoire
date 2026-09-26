// The next-scene step: the one step of the evening, under the open scene. It
// names where the DM reaches next so the left list does not have to be
// searched mid-sentence (UI-BRIEF §3).
//
// It lives at the END of the CENTER column of the live mode, which is the
// whole placement decision: the quick note is the second most important
// element of that view and sits in the aside, so a step here can neither
// cover it nor push itself between a scene and the field the DM types into.
// Quiet, one line, the title in the label — a step nobody can read at a
// glance is not a step.
//
// Left of the step, in the same row, the played box: ticked, the step
// marks the scene being left as played — its STATUS, the one place that
// says so — before the next scene opens; unticked, it just opens the next
// scene. The box starts ticked when the session holds a note taken in the
// scene (./session-scenes.ts) and follows that until the DM sets it; nothing
// is written before the step is taken. The box is state of this step only,
// so the page keys the step by the scene it leaves.
//
// The status write is the scene's: the page hands it in as `markPlayed`. When
// the scene changed elsewhere, the next scene does not open — the step says
// so, and the next click writes against the reloaded scene.

import type { Session } from "@grimoire/shared/session";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";

import { hasNoteInScene } from "./session-scenes";

export function NextSceneStep({
  session,
  left,
  next,
  markPlayed,
  onNext,
}: {
  session: Session;
  /** The scene that is open and is being left. */
  left: string;
  /** The scene the step leads to. */
  next: { id: string; title: string };
  /**
   * Mark `left` as played: true once it is, false when it changed elsewhere
   * and was reloaded instead.
   */
  markPlayed: (sceneId: string) => Promise<boolean>;
  /** Open the next scene. */
  onNext: (id: string) => void;
}) {
  const t = useT();
  const boxId = useId();
  // Undefined until the DM sets the box: until then it follows the log.
  const [chosen, setChosen] = useState<boolean>();
  const played = chosen ?? hasNoteInScene(session, left);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  const step = useMutation({
    mutationFn: ({ played }: { played: boolean; next: string }) =>
      played ? markPlayed(left) : Promise.resolve(true),
    onMutate: () => setChangedElsewhere(false),
    onSuccess: (done, { next }) => {
      if (done) onNext(next);
      else setChangedElsewhere(true);
    },
  });

  return (
    <div className="mt-8 border-t border-border pt-4">
      <div className="flex items-center gap-1">
        <label
          htmlFor={boxId}
          className="flex flex-none cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-[13.5px] text-body-secondary hover:text-foreground"
        >
          <Checkbox
            id={boxId}
            checked={played}
            disabled={step.isPending}
            onCheckedChange={(state) => setChosen(state === true)}
          />
          {t("live.next.played")}
        </label>
        <button
          type="button"
          disabled={step.isPending}
          onClick={() => {
            step.reset();
            step.mutate({ played, next: next.id });
          }}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2.5 text-left text-[13.5px] text-body-secondary transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none"
        >
          <span className="min-w-0 flex-1 truncate">{t("live.next", { title: next.title })}</span>
          <ArrowRight
            aria-hidden
            size={15}
            className="flex-none text-muted-foreground group-hover:text-primary"
          />
        </button>
      </div>
      {changedElsewhere && (
        <p className="mt-2 px-3 text-[12px] text-destructive" aria-live="polite">
          {t("live.next.changedElsewhere")}
        </p>
      )}
      {step.isError && (
        <p className="mt-2 px-3 text-[12px] text-destructive" aria-live="polite">
          {serverErrorMessage(step.error, t, "live.next.failed")}
        </p>
      )}
    </div>
  );
}
