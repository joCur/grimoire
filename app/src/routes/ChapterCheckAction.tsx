// The chapter check action of a chapter's reading view (decisions/generator).
// It joins the chapter with the generator job: the run starts on the
// campaign's job resource for this chapter, and its terms stage and its fixes
// are reviewed on the generator page, where the action leads. App.tsx hands
// it to the chapter's route as its check slot.
//
// There is one job per campaign: while another run waits there, the action
// says so and leads to it instead of starting — a new run would replace the
// one that is waiting.

import type { Chapter } from "@grimoire/shared/chapter";
import { isGeneratorJobSettled } from "@grimoire/shared/generator-job";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SpellCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError } from "@/api";
import { HeaderAction } from "@/components/HeaderAction";
import { startChapterCheckJob } from "@/generator-job/generator-job-api";
import {
  generateJobKey,
  useGenerateJob,
} from "@/generator-job/generator-job-query";
import { isChapterCheck, jobState } from "@/generator-job/generator-job-state";
import { generatorHref, jobHref } from "@/generator-job/job-links";
import { useT, type MessageKey } from "@/i18n";

export function ChapterCheckAction({
  campaign,
  chapter,
}: {
  campaign: string;
  chapter: Chapter;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const job = useGenerateJob(campaign).data;
  // A run with nothing left to decide — a check that found nothing — is over.
  const over =
    job !== null &&
    job !== undefined &&
    job.status === "done" &&
    isGeneratorJobSettled(job);
  const own = isChapterCheck(job) && job?.chapter === chapter.id && !over;
  const state = own ? jobState(job) : undefined;
  const [problem, setProblem] = useState<MessageKey>();

  const start = useMutation({
    mutationFn: () => startChapterCheckJob(campaign, chapter.id),
    onSuccess: (started) => {
      queryClient.setQueryData(generateJobKey(campaign), started);
      void navigate(generatorHref(campaign));
    },
    onError: (error) => {
      setProblem(
        error instanceof ApiError && error.status === 503
          ? "chapterCheck.noApiKey"
          : "chapterCheck.failed",
      );
    },
  });

  const onClick = (): void => {
    setProblem(undefined);
    // A run that is over is not in the way, and neither is this chapter's
    // failed check.
    const idle =
      job === null || job === undefined || over || (own && state === "failed");
    if (idle) {
      start.mutate();
      return;
    }
    // This chapter's check is reviewed on the generator page.
    if (own) {
      void navigate(generatorHref(campaign));
      return;
    }
    setProblem("chapterCheck.busy");
  };

  return (
    <span className="relative inline-flex">
      <HeaderAction
        icon={SpellCheck}
        label={t(
          start.isPending || state === "running"
            ? "chapterCheck.action.running"
            : state === "ready"
              ? "chapterCheck.action.ready"
              : state === "failed"
                ? "chapterCheck.action.failed"
                : "chapterCheck.action",
        )}
        onClick={onClick}
      />
      {problem !== undefined && (
        <span
          role="alert"
          data-testid="chapter-check-problem"
          className="absolute top-full right-0 z-20 mt-1.5 w-[min(300px,calc(100vw-40px))] rounded-md border border-input bg-card px-3 py-2.5 text-left text-[12.5px] leading-[1.5] text-body-secondary shadow-sm"
        >
          {t(problem)}
          {problem === "chapterCheck.busy" &&
            job !== null &&
            job !== undefined && (
              <Link
                to={jobHref(campaign, job)}
                className="mt-1.5 block text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t("chapterCheck.busyOpen")}
              </Link>
            )}
        </span>
      )}
    </span>
  );
}
