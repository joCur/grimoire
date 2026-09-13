// The provider's own two guarantees (issue #69 follow-up), both pure render —
// so `react-dom/server` is enough, the way the other component tests do it.
//
//   1. THE GATE: while `GET /api/settings` is pending, nothing language-
//      dependent is rendered. That is what keeps an instance set to German
//      from showing an English chrome for a frame in an English browser.
//   2. Once the setting is there, the STORED language wins over the browser's.
//
// `<html lang>` is an effect and therefore not observable here — it has its own
// assertion in e2e/tests/language.e2e.ts, against a real document.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, useT } from "./provider";

/** A child that can only render if it got a language. */
function Probe() {
  const t = useT();
  return <p>{t("topbar.search")}</p>;
}

function renderWith(client: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Probe />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** A client whose settings query never answers — the pending window. */
function pendingClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryDefaults(["settings"], { queryFn: () => new Promise(() => {}) });
  return client;
}

/** A client that already knows the instance's language. */
function settledClient(locale: string | null): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["settings"], { locale });
  return client;
}

describe("the first paint is gated", () => {
  test("renders no copy at all while the setting is unknown", () => {
    const html = renderWith(pendingClient());
    // The child never mounted, in EITHER language.
    expect(html).not.toContain("Suchen");
    expect(html).not.toContain("Search");
    // What is on screen is the neutral shell: a glyph, marked as busy.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("<svg");
  });

  test("and nothing below the provider ever sees a pending language", () => {
    // The gate is the reason `isPending` is always false for children — a view
    // that handled it would be handling a state that cannot occur.
    expect(renderWith(settledClient("en"))).toContain("Search");
  });
});

describe("the stored language wins", () => {
  test("German when the instance says de", () => {
    expect(renderWith(settledClient("de"))).toContain("Suchen");
  });

  test("English when the instance says en", () => {
    const html = renderWith(settledClient("en"));
    expect(html).toContain("Search");
    expect(html).not.toContain("Suchen");
  });

  test("no stored value falls back to the browser, silence to the default", () => {
    // This runner's `navigator` offers no language at all, and silence is not
    // "asked for something other than German" — so the primary language stands
    // (messages.ts `browserLocale`).
    expect(renderWith(settledClient(null))).toContain("Suchen");
  });
});
