// "/dev/markdown" — dev harness: renders the markdown pipeline against the
// reference scenes (the callout reference) without a running server. The
// fixtures are the scenes as their resource answers them, so the harness reads
// their `body` the way the reading view does and shows the other fields beside
// it. CLAUDE.md names exactly these two scenes as the check for renderer
// changes.

import lighthouseFixture from "../../../fixtures/beispiel/scenes/lighthouse-arrival.json";
import smugglersFixture from "../../../fixtures/beispiel/scenes/smuggler-captured.json";

import { useT } from "@/i18n";
import { Markdown } from "@/markdown/Markdown";

/** A fixture: its markdown body, and the fields beside it. */
type Fixture = { body: string } & Record<string, unknown>;

// Extra snippet exercising the degrade paths that the fixtures do not cover.
const degradeSample = `## If: die Gruppe flieht sofort

Ein Absatz innerhalb der Verzweigung.

> [!homebrew] Unbekannter Callout — muss als normales Zitat erscheinen.

## Ganz normale Überschrift

Text nach der Verzweigung, außerhalb des details-Elements.
`;

function FixtureSection({ name, fixture }: { name: string; fixture: Fixture }) {
  const t = useT();
  const { body, ...fields } = fixture;
  return (
    <section className="space-y-3 border-t pt-6">
      <h2 className="font-mono text-sm text-muted-foreground">{name}</h2>
      {Object.keys(fields).length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t("harness.properties")}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
            {JSON.stringify(fields, null, 2)}
          </pre>
        </details>
      )}
      <Markdown>{body}</Markdown>
    </section>
  );
}

export function HarnessRoute() {
  const t = useT();
  return (
    <div className="mx-auto max-w-[760px] space-y-8 px-7 py-10">
      <header>
        <h1 className="text-lg font-semibold">{t("harness.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("harness.lead")}</p>
      </header>
      <FixtureSection name="scenes/lighthouse-arrival" fixture={lighthouseFixture} />
      <FixtureSection name="scenes/smuggler-captured" fixture={smugglersFixture} />
      <FixtureSection name="degrade-beispiele (inline)" fixture={{ body: degradeSample }} />
    </div>
  );
}
