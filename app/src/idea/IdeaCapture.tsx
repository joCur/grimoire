// The idea capture card of the mobile start surface: a textarea and a brass
// submit action, with a quiet text confirmation (no animation — reduced-motion
// safe by construction). The answer is the new idea, which the cached ideas
// take at their end, so the wrap-up and the live aside see it at once.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Idea } from "@grimoire/shared/idea";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { createIdea } from "./idea-api";
import { ideasKey, withIdea } from "./idea-query";

export function IdeaCapture({ campaign }: { campaign: string }) {
  const t = useT();
  const inputId = useId();
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queryClient = useQueryClient();
  useEffect(() => () => clearTimeout(timer.current), []);

  const capture = useMutation({
    mutationFn: (line: string) => createIdea(campaign, line),
    onSuccess: (idea) => {
      queryClient.setQueryData<Idea[]>(ideasKey(campaign), (list) => withIdea(list, idea));
      setText("");
      setConfirmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirmed(false), 2500);
    },
    onMutate: () => setConfirmed(false),
  });

  const send = () => {
    const line = text.trim();
    if (line === "" || capture.isPending) return;
    capture.mutate(line);
  };

  return (
    <div className="rounded-xl border border-input bg-card px-4 pt-3.5 pb-3">
      <label htmlFor={inputId} className="sr-only">
        {t("mobileStart.inbox.label")}
      </label>
      <textarea
        id={inputId}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("mobileStart.inbox.placeholder")}
        className="min-h-11 w-full resize-none bg-transparent text-[16px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground md:text-[15px]"
      />
      <div className="flex items-center justify-end gap-3 pt-1">
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px]",
            confirmed ? "text-success-text" : "text-destructive",
          )}
        >
          {confirmed
            ? t("mobileStart.inbox.saved")
            : capture.isError
              ? t("mobileStart.inbox.failed")
              : ""}
        </p>
        <Button
          type="button"
          disabled={capture.isPending}
          onClick={send}
          className="h-auto min-h-11 flex-none px-4 py-2 text-[14px] font-semibold"
        >
          {t("mobileStart.inbox.submit")}
        </Button>
      </div>
    </div>
  );
}
