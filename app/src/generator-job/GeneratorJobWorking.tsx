// The working state of a run: the spinner while the SERVER's job runs, the
// correction-turn explainer and the one fact that matters — the run is on the
// server, so the tab may go.

import { useT } from "@/i18n";

/**
 * The working state: spinner + the correction-turn explainer + the one fact
 * that matters — the run is on the server, so the tab may
 * go. No number of attempts here: LLM_CORRECTION_TURNS is a server setting
 * (default 1) and a hardcoded "max. 2" would be a lie in half the setups.
 */
export function GeneratorJobWorking() {
  const t = useT();
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-[18px] py-24 text-center md:py-[120px]"
    >
      {/* Motion is optional: the ring animates only when motion is welcome,
          otherwise a static brass ring stands in for it. */}
      <span
        aria-hidden
        className="size-[30px] animate-spin rounded-full border-[3px] border-input border-t-primary motion-reduce:hidden"
      />
      <span
        aria-hidden
        className="hidden size-[30px] rounded-full border-[3px] border-primary motion-reduce:block"
      />
      <p className="text-[14.5px] text-foreground">{t("generate.working.title")}</p>
      <p className="max-w-[380px] text-[13px] leading-[1.6] text-muted-foreground">
        {t("generate.working.correction")}
      </p>
      <p className="max-w-[380px] text-[12.5px] leading-[1.6] text-faint">
        {t("generate.working.background")}
      </p>
    </div>
  );
}
