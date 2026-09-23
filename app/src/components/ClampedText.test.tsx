// The clamped text of the chapter overview: the WHOLE text goes through the
// markdown renderer, and the toggle is a measurement, not a guess — so the
// first render (and a static one) carries no toggle, and blank renders nothing.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import campaign from "../../../fixtures/beispiel/campaign.json";
import chapter from "../../../fixtures/beispiel/chapter-01-salzhafen.json";

import { CLAMP_LINES, ClampedText, textOverflows } from "./ClampedText";

describe("textOverflows", () => {
  const lineHeight = 22.4; // 14px at line-height 1.6, as .md-compact sets it

  test("a text of up to the clamped lines fits, one line more does not", () => {
    expect(textOverflows(lineHeight, lineHeight, CLAMP_LINES)).toBe(false);
    expect(textOverflows(CLAMP_LINES * lineHeight, lineHeight, CLAMP_LINES)).toBe(false);
    expect(textOverflows((CLAMP_LINES + 1) * lineHeight, lineHeight, CLAMP_LINES)).toBe(true);
  });

  test("sub-pixel rounding is no overflow", () => {
    expect(textOverflows(CLAMP_LINES * lineHeight + 0.6, lineHeight, CLAMP_LINES)).toBe(false);
  });

  test("an unreadable line height never shows the toggle", () => {
    expect(textOverflows(500, Number.NaN, CLAMP_LINES)).toBe(false);
    expect(textOverflows(500, 0, CLAMP_LINES)).toBe(false);
  });
});

describe("ClampedText", () => {
  test("renders the whole text through the markdown renderer", () => {
    const html = renderToStaticMarkup(<ClampedText>{chapter.body}</ClampedText>);
    expect(html).toContain('class="md-body"');
    expect(html).toContain("<p>Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.</p>");
    // Unmeasured: neither clamped nor with a toggle.
    expect(html).not.toContain("data-clamped");
    expect(html).not.toContain("<button");
  });

  test("a heading in the text is part of the text, not a selector", () => {
    const html = renderToStaticMarkup(
      <ClampedText>{`## Ziel des Kapitels\n\n${chapter.body}`}</ClampedText>,
    );
    expect(html).toContain("<h2>Ziel des Kapitels</h2>");
    expect(html).toContain("Herausfinden, warum das Leuchtfeuer");
  });

  test("every paragraph of the campaign text is there", () => {
    const html = renderToStaticMarkup(<ClampedText>{campaign.body}</ClampedText>);
    expect(html).toContain("Kampagnenweite Notizen");
    expect(html).toContain("kennt niemanden vor Ort.");
  });

  test("a blank text renders nothing", () => {
    expect(renderToStaticMarkup(<ClampedText>{""}</ClampedText>)).toBe("");
    expect(renderToStaticMarkup(<ClampedText>{"\n  \n"}</ClampedText>)).toBe("");
  });
});
