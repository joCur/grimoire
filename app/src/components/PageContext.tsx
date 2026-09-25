// The context line above a page title: the place of what is on screen in the
// hierarchy, rendered inside the page. Quiet, one line, `›` between the steps, the
// linkable step(s) as links.
//
// Desktop only (`max-md:hidden`) — below md MobileBackRow already answers
// "where am I / how do I get back" with its back link to the parent view.
// Deliberately NOT merged into that component: the back row is a full-width
// bar ABOVE the content container while this line sits INSIDE the content
// column, right above the title — one component cannot be in two DOM
// positions, and faking it would mean passing the crumbs through the route
// twice anyway.

import { Link } from "react-router";

import { useT } from "@/i18n";

/**
 * One step of the context line; without `to` it is plain text. The campaign
 * name is never one of them — it appears once in the whole chrome, in the
 * switcher — and each reading view names the steps of its own context.
 */
export interface ContextCrumb {
  label: string;
  to?: string;
}

export function PageContext({ crumbs }: { crumbs: ContextCrumb[] }) {
  const t = useT();
  if (crumbs.length === 0) return null;
  return (
    <nav
      aria-label={t("context.aria")}
      className="mb-2.5 hidden flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground md:flex"
    >
      {crumbs.map((crumb, index) => (
        <span key={`${index}-${crumb.label}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && (
            <span aria-hidden className="text-border-hover">
              ›
            </span>
          )}
          {crumb.to === undefined ? (
            <span className="truncate">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="truncate rounded-md hover:text-foreground">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
