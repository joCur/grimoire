// The reading view of a LOCATION (ADR #31): its name, the `atmosphere` line,
// the Roll20 page reference and its text — the same column and the same
// markdown pipeline as every other article.
//
// The Roll20 line stays PLAIN TEXT on purpose: the format references Roll20
// by name, it never links or copies it (README). The atmosphere reads exactly
// as the cards read it (./location-excerpt.ts): a `[[slug]]` inside reads as
// the current name.

import type { Location } from "@grimoire/shared/location";
import type { ReactNode } from "react";

import { ActionGroup, Title } from "@/components/ArticleHeader";
import { useT } from "@/i18n";
import { useRefs } from "@/markdown/refs";
import { Markdown } from "@/markdown/Markdown";

import { locationExcerpt } from "./location-excerpt";

export function LocationArticle({
  location,
  actions,
  body,
}: {
  location: Location;
  /** The header's quiet action slot — the route owns the actions. */
  actions?: ReactNode;
  /** Replaces the rendered text — edit mode puts its editor here. */
  body?: ReactNode;
}) {
  const t = useT();
  const { resolve } = useRefs();
  const { mood, page } = locationExcerpt(location, (slug) => resolve(slug)?.name);
  return (
    <article className="w-full min-w-0">
      <header className="mb-7 border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Title>{location.name}</Title>
          <ActionGroup>{actions}</ActionGroup>
        </div>
        {mood !== undefined && (
          <p className="mt-2 text-[14px] leading-[1.6] text-body-secondary">{mood}</p>
        )}
        {page !== undefined && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {t("entity.location.roll20", { value: page })}
          </p>
        )}
      </header>
      {body ?? <Markdown>{location.body}</Markdown>}
    </article>
  );
}
