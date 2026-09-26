// "/campaigns/:campaign/sessions/:id" — the reading page of ONE evening.
//
// The page is READ-ONLY and shows exactly what the server stored — when the
// evening started and ended, the pauses, the log in the order it was written,
// and the scenes its notes were taken in (./session-scenes.ts) as links back
// into the campaign. The session reads its children embedded (ADR #31). Where
// a scene lives is the scene's to say: the page is handed that link.
//
// The log row renders the way the live panel's rows do: the wall-clock time in
// mono, then the scene it was written under, then the text with its hashtags
// still in it — the tags are part of what the DM wrote down, and this page is
// the record, not the wrap-up.

import type { Pause } from "@grimoire/shared/pause";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { fetchTree } from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { PageContext } from "@/components/PageContext";
import { useT } from "@/i18n";
import { hasScene, sceneTitle } from "@/lib/campaign";

import { scenesWithNotes } from "./session-scenes";
import { formatDuration, sessionDateLabel, sessionElapsedMs, sessionTimeLabel } from "./session-time";
import { useSession } from "./use-session";

export function SessionRoute({
  sceneHref,
}: {
  /** The route of a scene of the campaign. */
  sceneHref: (campaign: string, id: string) => string;
}) {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const session = useSession(campaign, id);
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  if (session.isPending) {
    return (
      <p className="mx-auto max-w-[680px] px-5 pt-8 text-muted-foreground md:px-7 md:pt-10">
        {t("session.page.loading")}
      </p>
    );
  }
  const data = session.data;
  if (data === undefined) {
    return (
      <p className="mx-auto max-w-[680px] px-5 pt-8 text-muted-foreground md:px-7 md:pt-10">
        {t("session.page.notLoadable")}
      </p>
    );
  }

  const startedAt = sessionTimeLabel(data.started);
  const endedAt = sessionTimeLabel(data.ended);
  // The runtime of an ENDED evening is a fixed number; a session that is still
  // running has no final one, and this page does not tick — the live chip is
  // where a running clock belongs.
  const runtime =
    data.endedMs === undefined ? undefined : sessionElapsedMs(data, data.endedMs);
  // A pause is shown once it is over AND the server could read both of its
  // wall clocks — only then is there a duration to print.
  const closedPauses = data.pauses.filter(
    (pause): pause is Pause & { fromMs: number; toMs: number } =>
      pause.fromMs !== undefined && pause.toMs !== undefined,
  );
  const noteScenes = scenesWithNotes(data);

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[680px] px-5 pt-5 pb-24 md:px-7 md:pt-10 md:pb-[100px]">
        {/* There is no session LIST page, so the step above is a plain word:
            it says where this page sits without promising a link. */}
        <PageContext crumbs={[{ label: t("session.page.crumb") }]} />
        <h1 className="mb-2 font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
          {sessionDateLabel(data, t)}
        </h1>

        <dl className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
          <div className="flex items-baseline gap-1.5">
            <dt>{t("session.page.started")}</dt>
            <dd className="font-mono text-body-secondary">
              {startedAt ?? t("session.page.timeUnknown")}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>{t("session.page.ended")}</dt>
            <dd className="font-mono text-body-secondary">
              {endedAt ?? t("session.page.stillRunning")}
            </dd>
          </div>
          {runtime !== undefined && (
            <div className="flex items-baseline gap-1.5">
              <dt>{t("session.page.runtime")}</dt>
              <dd className="font-mono text-body-secondary">{formatDuration(runtime)}</dd>
            </div>
          )}
        </dl>

        <section className="mb-9" aria-labelledby="session-log-heading">
          <h2
            id="session-log-heading"
            className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground"
          >
            {t("session.page.log")}
          </h2>
          {data.log.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">{t("session.page.log.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.log.map((row) => {
                const known = hasScene(tree.data, row.sceneId);
                const title = sceneTitle(tree.data, row.sceneId);
                return (
                  <li key={row.id} className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[14px]">
                    {row.at !== "" && (
                      <span className="flex-none font-mono text-[12.5px] text-faint">
                        {row.at}
                      </span>
                    )}
                    {title !== undefined &&
                      (!known || row.sceneId === undefined ? (
                        // A scene the tree does not know: name it, claim no
                        // link (degrade, README).
                        <span className="flex-none text-[12.5px] text-muted-foreground">
                          {title}
                        </span>
                      ) : (
                        <Link
                          to={sceneHref(campaign, row.sceneId)}
                          className="flex-none rounded-md text-[12.5px] text-primary hover:text-primary-hover"
                        >
                          {title}
                        </Link>
                      ))}
                    <span className="min-w-0 flex-1 leading-[1.55] text-body">{row.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {closedPauses.length > 0 && (
          <section className="mb-9" aria-labelledby="session-pauses-heading">
            <h2
              id="session-pauses-heading"
              className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground"
            >
              {t("session.page.pauses")}
            </h2>
            <ul className="flex flex-col gap-1">
              {closedPauses.map((pause) => (
                <li key={pause.id} className="font-mono text-[12.5px] text-body-secondary">
                  {t("session.page.pauseRow", {
                    from: sessionTimeLabel(pause.from) ?? pause.from,
                    to: sessionTimeLabel(pause.to) ?? (pause.to ?? ""),
                    duration: formatDuration(pause.toMs - pause.fromMs),
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="session-scenes-heading">
          <h2
            id="session-scenes-heading"
            className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground"
          >
            {t("session.page.scenes")}
          </h2>
          {noteScenes.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">{t("session.page.scenes.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {noteScenes.map((sceneId) => {
                const title = sceneTitle(tree.data, sceneId) ?? sceneId;
                return (
                  <li key={sceneId} className="text-[14px]">
                    {!hasScene(tree.data, sceneId) ? (
                      <span className="text-body-secondary">{title}</span>
                    ) : (
                      <Link
                        to={sceneHref(campaign, sceneId)}
                        className="rounded-md text-primary hover:text-primary-hover"
                      >
                        {title}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
