// The stages of a scene run's review (decisions/generator): the steps at the
// top — locations, npcs, scenes, each with how much of it is decided — and
// the way on and back at the bottom. Which stage is shown and which can be
// reached is derived from the job (./generator-job-state.ts `reviewStages`,
// `currentStage`); going somewhere is the caller's write of `review.stage`.

import type { GeneratorReviewStage } from "@grimoire/shared/generator-job";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

import type { ReviewStageState } from "./generator-job-state";

const STAGE_LABEL: Record<GeneratorReviewStage, MessageKey> = {
  locations: "generate.stage.locations",
  npcs: "generate.stage.npcs",
  scenes: "generate.stage.scenes",
};

/** The steps of the review — only the stages that have proposals. */
export function ReviewStageSteps({
  stages,
  current,
  onGo,
}: {
  stages: ReviewStageState[];
  current: GeneratorReviewStage;
  onGo: (stage: GeneratorReviewStage) => void;
}) {
  const t = useT();
  const shown = stages.filter((stage) => stage.total > 0);
  const locked = shown.some((stage) => !stage.reachable);
  return (
    <nav aria-label={t("generate.stage.nav")} className="mb-[22px]">
      <ol className="flex flex-wrap gap-2">
        {shown.map((stage, index) => {
          const on = stage.stage === current;
          return (
            <li key={stage.stage}>
              <button
                type="button"
                data-testid={`review-step:${stage.stage}`}
                aria-current={on ? "step" : undefined}
                disabled={!stage.reachable}
                onClick={() => onGo(stage.stage)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3.5 py-[5px] text-[12.5px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                  on
                    ? "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-hover"
                    : "border-border bg-card text-body-secondary hover:border-border-hover hover:text-foreground",
                )}
              >
                {stage.complete ? (
                  <Check aria-hidden size={13} className="flex-none text-success-text" />
                ) : (
                  <span aria-hidden className="font-mono text-[11px] text-faint">
                    {index + 1}
                  </span>
                )}
                <span>{t(STAGE_LABEL[stage.stage])}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {t("generate.stage.decided", { decided: stage.decided, total: stage.total })}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {locked && (
        <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
          {t("generate.stage.locked")}
        </p>
      )}
    </nav>
  );
}

const NEXT_LABEL: Partial<Record<GeneratorReviewStage, MessageKey>> = {
  npcs: "generate.stage.next.npcs",
  scenes: "generate.stage.next.scenes",
};

const BACK_LABEL: Partial<Record<GeneratorReviewStage, MessageKey>> = {
  locations: "generate.stage.back.locations",
  npcs: "generate.stage.back.npcs",
};

/**
 * The way back to the stage before and on to the next one. The way on opens
 * once every proposal of this stage is decided; until then the row says how
 * many are left.
 */
export function ReviewStageNav({
  stages,
  current,
  onGo,
}: {
  stages: ReviewStageState[];
  current: GeneratorReviewStage;
  onGo: (stage: GeneratorReviewStage) => void;
}) {
  const t = useT();
  const shown = stages.filter((stage) => stage.total > 0);
  const index = shown.findIndex((stage) => stage.stage === current);
  const here = shown[index];
  const previous = index > 0 ? shown[index - 1] : undefined;
  const next = index >= 0 ? shown[index + 1] : undefined;
  if (here === undefined || (previous === undefined && next === undefined)) return null;
  const nextLabel = next === undefined ? undefined : NEXT_LABEL[next.stage];
  const backLabel = previous === undefined ? undefined : BACK_LABEL[previous.stage];
  return (
    <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
      {previous !== undefined && backLabel !== undefined && (
        <Button
          type="button"
          variant="outline"
          data-testid="review-back"
          onClick={() => onGo(previous.stage)}
          className="h-auto gap-1.5 border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
        >
          <ArrowLeft aria-hidden />
          {t(backLabel)}
        </Button>
      )}
      {next !== undefined && nextLabel !== undefined && (
        <Button
          type="button"
          data-testid="review-next"
          disabled={!here.complete || !next.reachable}
          onClick={() => onGo(next.stage)}
          className="h-auto gap-1.5 px-[18px] py-2.5 text-[13.5px] font-semibold"
        >
          {t(nextLabel)}
          <ArrowRight aria-hidden />
        </Button>
      )}
      {!here.complete && (
        <p className="text-[12.5px] text-muted-foreground">
          {t("generate.stage.open", { count: here.total - here.decided })}
        </p>
      )}
    </div>
  );
}
