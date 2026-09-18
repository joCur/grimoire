// The id line: what is on screen in each of its states, that the pencil is a
// real button with a name, and that an id the rule rejects says so.
//
// Rendered as markup, so the assertions are the DOM contract the keyboard and
// the E2E suite rely on — the focus move that entering the editable state
// performs is an effect and belongs to the real browser (e2e/tests/
// cold-start.e2e.ts).

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { IdField } from "./IdField";

type Props = Parameters<typeof IdField>[0];

/** Without a provider the catalog answers in the primary language. */
function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <IdField
      prefix="npcs/"
      id="alte-fischerin"
      editing={false}
      invalid={false}
      onToggle={() => {}}
      onChange={() => {}}
      {...props}
    />,
  );
}

describe("the quiet line", () => {
  test("shows prefix and id as ONE run of text, plus the pencil", () => {
    const html = render();
    expect(html).toContain("npcs/alte-fischerin");
    // No field yet: the id is text, not something to type over by accident.
    expect(html).not.toContain("<input");
    expect(html).toContain('aria-label="Kennung selbst setzen"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="false"');
  });

  test("a chapter has no prefix, so the id IS the address", () => {
    expect(render({ prefix: "", id: "01-salzhafen" })).toContain("01-salzhafen");
  });

  test("stays empty while the name yields no id — and offers no pencil", () => {
    const html = render({ id: "" });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });
});

describe("the editable field", () => {
  test("carries the id, is named, and the prefix stays outside it", () => {
    const html = render({ editing: true });
    expect(html).toContain('value="alte-fischerin"');
    expect(html).toContain('aria-label="Kennung"');
    // The prefix is context, not part of what can be typed.
    expect(html).toContain(">npcs/<");
    expect(html).not.toContain('value="npcs/alte-fischerin"');
  });

  test("the pencil reports itself as the pressed toggle", () => {
    expect(render({ editing: true })).toContain('aria-pressed="true"');
  });

  test("an empty id keeps the field on screen once it is open", () => {
    const html = render({ editing: true, id: "" });
    expect(html).toContain("<input");
  });
});

describe("an id the rule rejects", () => {
  test("names the rule and wires it to the field", () => {
    const html = render({ editing: true, id: "Alte Fischerin!", invalid: true });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Kleinbuchstaben");
    expect(html).toContain("Bindestriche");
    expect(html).toContain("aria-describedby");
  });

  test("a legal id says nothing at all", () => {
    const html = render({ editing: true });
    expect(html).toContain('aria-invalid="false"');
    expect(html).not.toContain("Kleinbuchstaben");
    expect(html).not.toContain("aria-describedby");
  });
});

describe("the catalog", () => {
  test("answers all three keys in both languages", () => {
    // Nothing is built in the component, so a missing key would show as a
    // blank label on a button that is then unreachable by name.
    for (const key of ["idField.label", "idField.edit", "idField.invalid"] as const) {
      for (const locale of ["de", "en"] as const) {
        expect(translator(locale)(key).trim()).not.toBe("");
      }
    }
  });
});
