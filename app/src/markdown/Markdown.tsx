// The markdown pipeline: react-markdown + the Grimoire remark plugin.
// The plugin annotates callouts as `<section data-callout>` and `## If:`
// sections as `<details data-if-section>`; the component overrides below
// map those elements to their React rendering.

import ReactMarkdown, { type Components } from "react-markdown";

import { Callout } from "./Callout";
import { remarkGrimoire } from "./remark-grimoire";

const components: Components = {
  section(props) {
    const { node: _node, children, ...rest } = props;
    const attrs = rest as Record<string, unknown>;
    const kind = attrs["data-callout"];
    if (typeof kind === "string") {
      const copyText = attrs["data-copy-text"];
      return (
        <Callout kind={kind} copyText={typeof copyText === "string" ? copyText : undefined}>
          {children}
        </Callout>
      );
    }
    return <section {...rest}>{children}</section>;
  },
  summary(props) {
    // Summaries only come from the plugin (raw HTML is not rendered).
    const { node: _node, children, ...rest } = props;
    return (
      <summary {...rest}>
        <span className="font-medium text-muted-foreground">Falls: </span>
        {children}
      </summary>
    );
  },
};

const remarkPlugins = [remarkGrimoire];

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
