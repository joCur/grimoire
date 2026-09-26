// The shared raw editor:
// exactly one of the two surfaces is on screen, the toggle names the OTHER
// one, and the aria wiring points at the textarea only while it exists.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { EditorShell, MarkdownEditorSurface, MarkdownEditorToggle } from "./MarkdownEditor";

/** Without a provider the catalog answers in the primary language. */
const t = translator("de");

const BODY = "## Flow\n\nThe lighthouse is dark.\n";

describe("MarkdownEditorToggle", () => {
  test("offers the preview while editing and points at the textarea", () => {
    const html = renderToStaticMarkup(
      <MarkdownEditorToggle editing onToggleEditing={() => {}} controlsId="raw-1" />,
    );
    expect(html).toContain(t("editor.preview"));
    expect(html).not.toContain(t("common.edit"));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="raw-1"');
  });

  test("offers editing in preview mode and controls nothing", () => {
    const html = renderToStaticMarkup(
      <MarkdownEditorToggle editing={false} onToggleEditing={() => {}} controlsId="raw-1" />,
    );
    expect(html).toContain(t("common.edit"));
    expect(html).not.toContain(t("editor.preview"));
    expect(html).toContain('aria-expanded="false"');
    // No textarea on screen — nothing to announce as the controlled region.
    expect(html).not.toContain("aria-controls");
  });
});

describe("MarkdownEditorSurface", () => {
  const surface = (props: Partial<Parameters<typeof MarkdownEditorSurface>[0]> = {}) =>
    renderToStaticMarkup(
      <MarkdownEditorSurface
        value={BODY}
        onChange={() => {}}
        editing
        id="raw-1"
        label="Markdown of the arrival"
        {...props}
      />,
    );

  test("editing shows the mono textarea with the raw markdown", () => {
    const html = surface();
    expect(html).toContain('id="raw-1"');
    expect(html).toContain('rows="22"');
    expect(html).toContain("font-mono");
    expect(html).toContain('aria-label="Markdown of the arrival"');
    expect(html).toContain("The lighthouse is dark.");
    // The raw source is in the textarea, not rendered into a heading.
    expect(html).not.toContain("<h2");
  });

  test("preview renders through the markdown pipeline instead", () => {
    const html = surface({ editing: false });
    expect(html).not.toContain("<textarea");
    expect(html).toContain('class="md-body"');
    expect(html).toContain("<h2");
    expect(html).toContain("The lighthouse is dark.");
  });
});

describe("EditorShell", () => {
  // The frame the callers compose themselves: the reading view puts its mode
  // switch and its save/cancel actions in here (BodyEditor). The shell
  // owns the toolbar row, nothing else.
  const shell = (editing: boolean) =>
    renderToStaticMarkup(
      <EditorShell
        controls={
          <MarkdownEditorToggle
            editing={editing}
            onToggleEditing={() => {}}
            controlsId="body-scene"
          />
        }
        // Stand-in caller markup, not app copy — hence the literal (in an
        // expression container, which is what the i18n lint rule asks for).
        actions={<button type="button">{"Save"}</button>}
      >
        <MarkdownEditorSurface
          value={BODY}
          onChange={() => {}}
          editing={editing}
          id="body-scene"
          label="Markdown text of 01-salt-harbour/lighthouse/lighthouse-arrival"
        />
      </EditorShell>,
    );

  test("toolbar, caller actions and the textarea are one block", () => {
    const html = shell(true);
    expect(html).toContain(t("editor.preview"));
    expect(html).toContain(">Save</button>");
    expect(html).toContain('id="body-scene"');
    expect(html).toContain('aria-controls="body-scene"');
  });

  test("the toggle flips the surface to the rendered preview", () => {
    const html = shell(false);
    expect(html).toContain(t("common.edit"));
    expect(html).not.toContain("<textarea");
    expect(html).toContain('class="md-body"');
    // The actions stay reachable in preview mode — saving must not need a
    // detour back into the textarea.
    expect(html).toContain(">Save</button>");
  });

  test("a shell without actions renders no action slot at all", () => {
    const html = renderToStaticMarkup(
      <EditorShell controls={<span>{"Blocks"}</span>}>
        <p>{"Block list"}</p>
      </EditorShell>,
    );
    expect(html).toContain("<span>Blocks</span>");
    expect(html).toContain("<p>Block list</p>");
    expect(html).not.toContain("ml-auto");
  });
});
