// The markdown pipeline: react-markdown + the Grimoire remark plugin.
// The plugin annotates callouts as `<section data-callout>` and `## If:`
// sections as `<details data-if-section open>`; the component overrides
// below map those elements to their React rendering per the design
// reference: a borderless summary row — chevron, brass „Falls:" prefix,
// italic condition — over 18px-indented content, no box.
//
// The INITIAL state of those branches belongs to the VIEW, not to the format:
// `ifSections` says whether a text opens with its branches unfolded
// (everywhere the DM reads or edits) or collapsed (the scene column of the
// live view, where only the case that happens at the table is opened). The
// plugin is untouched by that choice — it always marks a branch open.

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";

import { renderEntityRefPieces, type EntityRefPiece } from "@grimoire/shared/refs";

import { useT } from "@/i18n";

import { Callout } from "./Callout";
import { EntityRef, EntityRefName, useEntityRefs } from "./entity-refs";
import {
  COPY_PARTS_ATTR,
  ENTITY_REF_ATTR,
  ENTITY_REF_PLAIN_ATTR,
  remarkGrimoire,
} from "./remark-grimoire";
import { remarkTable } from "./remark-table";

const components: Components = {
  section(props) {
    const { node: _node, children, ...rest } = props;
    const attrs = rest as Record<string, unknown>;
    const kind = attrs["data-callout"];
    if (typeof kind === "string") {
      const parts = attrs[COPY_PARTS_ATTR];
      return (
        <CalloutSection kind={kind} copyParts={typeof parts === "string" ? parts : undefined}>
          {children}
        </CalloutSection>
      );
    }
    return <section {...rest}>{children}</section>;
  },
  // `[[slug]]`: the plugin marked it, the tree resolves it.
  span(props) {
    const { node: _node, children, ...rest } = props;
    const attrs = rest as Record<string, unknown>;
    const slug = attrs[ENTITY_REF_ATTR];
    if (typeof slug !== "string") return <span {...rest}>{children}</span>;
    // Inside a `## If:` summary a reference is the resolved NAME AS TEXT —
    // the row's own click must toggle the branch, not navigate away.
    if (attrs[ENTITY_REF_PLAIN_ATTR] !== undefined) {
      return <EntityRefName slug={slug} fallback={children} />;
    }
    return <EntityRef slug={slug} fallback={children} />;
  },
  // A table never widens the page: it scrolls inside its own box.
  table(props) {
    const { node: _node, children, ...rest } = props;
    return <TableScroll {...rest}>{children}</TableScroll>;
  },
  summary(props) {
    // Summaries only come from the plugin (raw HTML is not rendered).
    const { node: _node, children, ...rest } = props;
    return <IfSummary {...rest}>{children}</IfSummary>;
  },
};

/** How a view opens the `## If:` branches of a text: unfolded, or folded away. */
export type IfSections = "open" | "collapsed";

/**
 * The `<details>` override for ONE initial state.
 *
 * The plugin marks every branch open, so the collapsed variant simply OMITS
 * the attribute — it never passes `open={false}`. The element stays
 * uncontrolled that way, and a re-render of the column (a quick note, the
 * session poll) cannot fold a branch the DM just opened at the table.
 */
function ifDetails(ifSections: IfSections): Components["details"] {
  return function IfDetails({
    node: _node,
    children,
    ...rest
  }: ComponentProps<"details"> & ExtraProps) {
    const attrs = rest as Record<string, unknown>;
    // Only if-sections get the branch styling; anything else stays native.
    if (attrs["data-if-section"] === undefined) return <details {...rest}>{children}</details>;
    const { open: _open, ...folded } = rest;
    return (
      <details
        {...(ifSections === "collapsed" ? folded : rest)}
        className="group mt-2.5 [&>:not(summary)]:ml-[18px]"
      >
        {children}
      </details>
    );
  };
}

/**
 * The two component sets, built ONCE at module scope. Building them per
 * render would hand React a new component identity every time, and a
 * remounted `<details>` loses the branch the DM has open.
 */
const COMPONENTS: Record<IfSections, Components> = {
  open: { ...components, details: ifDetails("open") },
  collapsed: { ...components, details: ifDetails("collapsed") },
};

/**
 * The horizontal-scroll box around a rendered table. `min-w-0` on the callout
 * body and `max-w-full` here are what keep a wide W6 table from pushing the
 * page sideways at 390px — the box scrolls, `document.documentElement` does
 * not (E2E, critical path 2).
 *
 * The box becomes a focusable, named region ONLY while it actually overflows:
 * a narrow two-column table that fits has nothing to scroll, and a tab stop
 * plus a landmark announcement there would be noise in the reading flow.
 * A `ResizeObserver` re-decides on every width change (rotation, sidebar).
 */
function TableScroll({ children, ...rest }: ComponentProps<"table">) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (box === null) return;
    setOverflows(box.scrollWidth > box.clientWidth);
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const table = box.firstElementChild;
    if (table !== null) observer.observe(table);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return (
    <div
      ref={boxRef}
      role={overflows ? "region" : undefined}
      aria-label={overflows ? t("markdown.table.aria") : undefined}
      tabIndex={overflows ? 0 : undefined}
      className="md-table-scroll"
    >
      <table {...rest}>{children}</table>
    </div>
  );
}

/**
 * The summary row of an `## If:` branch: chevron, the brass „Falls:" prefix
 * from the catalog (the branch label is copy, the `## If:` in the ENTRY'S TEXT
 * is not) and the italic condition.
 */
function IfSummary({ children, ...rest }: ComponentProps<"summary">) {
  const t = useT();
  return (
    <summary
      {...rest}
      className="flex w-full cursor-pointer list-none items-center gap-2 border-t border-border pt-3.5 pb-3 text-[14px] text-foreground select-none hover:text-primary-hover [&::-webkit-details-marker]:hidden"
    >
      <ChevronDown
        aria-hidden
        size={15}
        className="flex-none -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
      />
      <span className="font-semibold text-primary">{t("markdown.ifSection.prefix")}</span>
      <span className="italic">{children}</span>
    </summary>
  );
}

/**
 * A callout, with the read-aloud CLIPBOARD text resolved: the plugin splits
 * the raw mdast into `data-copy-parts`, so a `[[slug]]` in a read-aloud
 * would otherwise land in the Roll20 chat as brackets. What the DM
 * copies has to be what the DM reads — which is also why the PIECES come from
 * the plugin: a reference the page shows literally (inside code) is a text
 * piece there and is never resolved here.
 */
function CalloutSection({
  kind,
  copyParts,
  children,
}: {
  kind: string;
  copyParts?: string;
  children: ReactNode;
}) {
  const { resolve } = useEntityRefs();
  const text =
    copyParts === undefined
      ? undefined
      : renderEntityRefPieces(parseCopyParts(copyParts), (slug) => resolve(slug)?.name);
  return (
    <Callout kind={kind} copyText={text}>
      {children}
    </Callout>
  );
}

/** The pieces come from our own plugin; a broken payload copies nothing. */
function parseCopyParts(value: string): EntityRefPiece[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as EntityRefPiece[]) : [];
  } catch {
    return [];
  }
}

const remarkPlugins = [remarkTable, remarkGrimoire];

export function Markdown({
  children,
  ifSections = "open",
}: {
  children: string;
  /** Default: every branch unfolded — the collapsed start is the live view's. */
  ifSections?: IfSections;
}) {
  return (
    <div className="md-body">
      {/* skipHtml: raw HTML in a body is DROPPED, not printed. Without it
          react-markdown shows the raw source as text — the generator's
          `<!-- wird von der App … -->` hints ended up visible under
          `## Notizen`. Nothing in the format needs HTML: callouts and
          `## If:` sections become elements through the remark plugin's
          hName, never through raw HTML. */}
      <ReactMarkdown remarkPlugins={remarkPlugins} components={COMPONENTS[ifSections]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
