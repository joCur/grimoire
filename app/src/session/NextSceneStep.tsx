// "Nächste Szene": the one step of the evening, under the open scene. It
// names where the DM reaches next so the left list does not have to be
// searched mid-sentence (UI-BRIEF §3).
//
// It lives at the END of the CENTER column of the live mode, which is the
// whole placement decision: the Schnellnotiz is the second most important
// element of that view and sits in the aside, so a step here can neither
// cover it nor push itself between a scene and the field the DM types into.
// Quiet, one line, the title in the label — a step nobody can read at a
// glance is not a step.
//
// Leaving a scene this way is what records it as played — when the session
// holds a note taken in it, and once per session (./played-scene-rule.ts).
// The next scene opens once that write has landed.

import type { Session } from "@grimoire/shared/session";
import { ArrowRight } from "lucide-react";

import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";

import { useNextScene } from "./use-session";

export function NextSceneStep({
  campaign,
  session,
  left,
  next,
  onNext,
}: {
  campaign: string;
  session: Session;
  /** The scene that is open and is being left. */
  left: string;
  /** The scene the step leads to. */
  next: { id: string; title: string };
  /** Open the next scene. */
  onNext: (id: string) => void;
}) {
  const t = useT();
  const step = useNextScene(campaign, onNext);
  return (
    <div className="mt-8 border-t border-border pt-4">
      <button
        type="button"
        disabled={step.isPending}
        onClick={() => {
          step.reset();
          step.mutate({ session, left, next: next.id });
        }}
        className="group flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-[13.5px] text-body-secondary transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none"
      >
        <span className="min-w-0 flex-1 truncate">{t("live.next", { title: next.title })}</span>
        <ArrowRight
          aria-hidden
          size={15}
          className="flex-none text-muted-foreground group-hover:text-primary"
        />
      </button>
      {step.isError && (
        <p className="mt-2 px-3 text-[12px] text-destructive" aria-live="polite">
          {serverErrorMessage(step.error, t, "live.next.failed")}
        </p>
      )}
    </div>
  );
}
