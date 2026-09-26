// The header triggers of the reading views — the edit action for the text and
// the dialog action for the other fields — are ONE component. That is what is
// asserted here: each call site is compared against a live render of the
// equivalent <HeaderAction …/> instead of against frozen markup (pinning
// lucide-react/react-dom byte output would break on every dependency bump
// without a single pixel moving). The entities' own triggers are asserted in
// their slices.

import { describe, expect, test } from "bun:test";
import { PenLine, SlidersHorizontal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { BodyEditAction } from "./BodyEditor";
import { FieldsDialogAction } from "./fields/FieldsDialog";
import { HeaderAction } from "./HeaderAction";

/** Without a provider the catalog answers in the primary language. */
const t = translator("de");

/** The shared trigger with the edit glyph. */
function headerAction(label: string): string {
  return renderToStaticMarkup(<HeaderAction icon={PenLine} label={label} onClick={() => {}} />);
}

describe("HeaderAction", () => {
  test("is the quiet header trigger: a plain button, decorative icon, label", () => {
    // The one explicit assertion on the shape — the class list is the thing
    // separate copies would drift apart in.
    expect(headerAction("Label")).toStartWith(
      '<button type="button" class="inline-flex flex-none items-center gap-1.5 rounded-md px-1.5 py-1' +
        ' text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">' +
        "<svg ",
    );
    expect(headerAction("Label")).toEndWith("</svg>Label</button>");
    // The glyph carries no meaning of its own; the label does.
    expect(headerAction("Label")).toContain('aria-hidden="true"');
  });

  test("the label is the only thing that varies", () => {
    expect(headerAction("Other label")).toBe(
      headerAction("Label").replace("Label<", "Other label<"),
    );
  });
});

describe("the call sites", () => {
  test("the edit action of the body editor is the shared trigger", () => {
    expect(renderToStaticMarkup(<BodyEditAction onEdit={() => {}} />)).toBe(
      headerAction(t("common.edit")),
    );
  });

  test("the action of the fields dialog is the shared trigger with its own glyph", () => {
    expect(
      renderToStaticMarkup(<FieldsDialogAction openKey="example/x">{() => null}</FieldsDialogAction>),
    ).toBe(
      renderToStaticMarkup(
        <HeaderAction icon={SlidersHorizontal} label={t("properties.action")} onClick={() => {}} />,
      ),
    );
  });
});
