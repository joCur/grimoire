// The shared raw editor (issue #15, extracted from the generator review):
// exactly one of the two surfaces is on screen, the toggle names the OTHER
// one, and the aria wiring points at the textarea only while it exists.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownEditor, MarkdownEditorSurface, MarkdownEditorToggle } from "./MarkdownEditor";

const BODY = "## Flow\n\nDer Leuchtturm ist dunkel.\n";

describe("MarkdownEditorToggle", () => {
  test("offers Vorschau while editing and points at the textarea", () => {
    const html = renderToStaticMarkup(
      <MarkdownEditorToggle editing onToggleEditing={() => {}} controlsId="raw-1" />,
    );
    expect(html).toContain("Vorschau");
    expect(html).not.toContain("Bearbeiten");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="raw-1"');
  });

  test("offers Bearbeiten in preview mode and controls nothing", () => {
    const html = renderToStaticMarkup(
      <MarkdownEditorToggle editing={false} onToggleEditing={() => {}} controlsId="raw-1" />,
    );
    expect(html).toContain("Bearbeiten");
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
        label="Roh-Markdown von Ankunft"
        {...props}
      />,
    );

  test("editing shows the mono textarea with the raw markdown", () => {
    const html = surface();
    expect(html).toContain('id="raw-1"');
    expect(html).toContain('rows="22"');
    expect(html).toContain("font-mono");
    expect(html).toContain('aria-label="Roh-Markdown von Ankunft"');
    expect(html).toContain("Der Leuchtturm ist dunkel.");
    // The raw source is in the textarea, not rendered into a heading.
    expect(html).not.toContain("<h2");
  });

  test("preview renders through the markdown pipeline instead", () => {
    const html = surface({ editing: false });
    expect(html).not.toContain("<textarea");
    expect(html).toContain('class="md-body"');
    expect(html).toContain("<h2");
    expect(html).toContain("Der Leuchtturm ist dunkel.");
  });

  test("a separate preview string wins over the value (generator drafts)", () => {
    const html = surface({
      editing: false,
      value: "---\nid: arrival\n---\n\nNur der Körper.\n",
      preview: "Nur der Körper.\n",
    });
    expect(html).toContain("Nur der Körper.");
    expect(html).not.toContain("id: arrival");
  });
});

describe("MarkdownEditor", () => {
  const editor = (props: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) =>
    renderToStaticMarkup(
      <MarkdownEditor
        value={BODY}
        onChange={() => {}}
        editing
        onToggleEditing={() => {}}
        id="file-body-scene"
        label="Markdown-Text der Datei"
        actions={<button type="button">Speichern</button>}
        {...props}
      />,
    );

  test("toolbar, caller actions and the textarea are one block", () => {
    const html = editor();
    expect(html).toContain("Vorschau");
    expect(html).toContain("Speichern");
    expect(html).toContain('id="file-body-scene"');
    expect(html).toContain('aria-controls="file-body-scene"');
  });

  test("the toggle flips the block to the rendered preview", () => {
    const html = editor({ editing: false });
    expect(html).toContain("Bearbeiten");
    expect(html).not.toContain("<textarea");
    expect(html).toContain('class="md-body"');
    // The actions stay reachable in preview mode — saving must not need a
    // detour back into the textarea.
    expect(html).toContain("Speichern");
  });
});
