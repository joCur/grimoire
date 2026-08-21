// The context line above a page title (issue #34, PO rework of PR #35): the
// hierarchical context the topbar breadcrumb used to carry, moved into the
// page. Quiet, one line, `›` between the steps, the linkable step(s) as links.
//
// Desktop only (`max-md:hidden`) — below md MobileBackRow already answers
// "where am I / how do I get back" with the "‹ Pool" row from the mobile
// design. Deliberately NOT merged into that component: the back row is a
// full-width bar ABOVE the content container while this line sits INSIDE the
// content column, right above the title — one component cannot be in two DOM
// positions, and faking it would mean passing the crumbs through the route
// twice anyway.

import { Link } from "react-router";

import type { ContextCrumb } from "@/lib/page-context";

export function PageContext({ crumbs }: { crumbs: ContextCrumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav
      aria-label="Kontext"
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
