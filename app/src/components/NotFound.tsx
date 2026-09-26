// The page for an address that leads nowhere: a route the app does not know,
// or a row the server answers 404 for. Both are the same to the DM, so both
// show this one view — inside the layout, so the topbar stays. The way back is
// the campaign's chapter overview when the campaign is known, else the start
// ("/" enters the last active campaign).

import { Link } from "react-router";

import { useT } from "@/i18n";

export function NotFound({ campaign }: { campaign?: string }) {
  const t = useT();
  return (
    <section className="mx-auto max-w-[560px] px-5 pt-16 pb-20 md:px-7">
      <h1 className="mb-2 font-serif text-[22px] leading-[1.3] font-semibold text-foreground">
        {t("notFound.title")}
      </h1>
      <p className="mb-5 text-[14.5px] text-muted-foreground">{t("notFound.body")}</p>
      <Link
        to={campaign === undefined ? "/" : `/campaigns/${campaign}`}
        className="inline-flex min-h-11 items-center rounded-md text-[15px] text-primary hover:text-primary-hover"
      >
        {campaign === undefined ? t("notFound.toStart") : t("notFound.toCampaign")}
      </Link>
    </section>
  );
}
