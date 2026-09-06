// The markdown pipeline: react-markdown + the Grimoire remark plugin.
// The plugin annotates callouts as `<section data-callout>` and `## If:`
// sections as `<details data-if-section open>`; the component overrides
// below map those elements to their React rendering per the design
// reference: a borderless summary row — chevron, brass "Falls:" prefix,
// italic condition — over 18px-indented content, no box.

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

import { renderEntityRefPieces, type EntityRefPiece } from "@grimoire/shared/refs";

import { Callout } from "./Callout";
import { EntityRef, EntityRefName, useEntityRefs } from "./entity-refs";
import {
  COPY_PARTS_ATTR,
  ENTITY_REF_ATTR,
  ENTITY_REF_PLAIN_ATTR,
  remarkGrimoire,
} from "./remark-grimoire";

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
  // `[[slug]]` (issue #68): the plugin marked it, the tree resolves it.
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
  details(props) {
    const { node: _node, children, ...rest } = props;
    const attrs = rest as Record<string, unknown>;
    // Only if-sections get the branch styling; anything else stays native.
    if (attrs["data-if-section"] === undefined) return <details {...rest}>{children}</details>;
    return (
      <details {...rest} className="group mt-2.5 [&>:not(summary)]:ml-[18px]">
        {children}
      </details>
    );
  },
  summary(props) {
    // Summaries only come from the plugin (raw HTML is not rendered).
    const { node: _node, children, ...rest } = props;
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
        <span className="font-semibold text-primary">Falls:</span>
        <span className="italic">{children}</span>
      </summary>
    );
  },
};

/**
 * A callout, with the read-aloud CLIPBOARD text resolved (issue #68): the
 * plugin splits the raw mdast into `data-copy-parts`, so a `[[slug]]` in a
 * read-aloud would otherwise land in the Roll20 chat as brackets. What the DM
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

const remarkPlugins = [remarkGrimoire];

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      {/* skipHtml: raw HTML in a body is DROPPED, not printed. Without it
          react-markdown shows the raw source as text — the generator's
          `<!-- wird von der App … -->` hints ended up visible under
          `## Notizen` (review of issue #26). Nothing in the format needs
          HTML: callouts and `## If:` sections become elements through the
          remark plugin's hName, never through raw HTML. */}
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
