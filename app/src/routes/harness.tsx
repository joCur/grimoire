// "/dev/markdown" — dev harness: renders the markdown pipeline against the
// reference fixtures (the callout reference) without a running server. The
// fixtures are entries in the shape the API speaks, so the harness reads their
// `body` the way the reading view does. CLAUDE.md names exactly these two
// entries as the check for renderer changes.

import lighthouseFixture from "../../../fixtures/beispiel/scene-lighthouse-arrival.json";
import smugglersFixture from "../../../fixtures/beispiel/scene-smuggler-captured.json";

import { useT } from "@/i18n";
import { Markdown } from "@/markdown/Markdown";

/** An entry fixture: its properties and its markdown body. */
interface EntryFixture {
  properties?: Record<string, unknown>;
  body: string;
}

// Extra snippet exercising the degrade paths that the fixtures do not cover.
const degradeSample = `## If: die Gruppe flieht sofort

Ein Absatz innerhalb der Verzweigung.

> [!homebrew] Unbekannter Callout — muss als normales Zitat erscheinen.

## Ganz normale Überschrift

Text nach der Verzweigung, außerhalb des details-Elements.
`;

function Fixture({ name, entry }: { name: string; entry: EntryFixture }) {
  const t = useT();
  const { properties, body } = entry;
  return (
    <section className="space-y-3 border-t pt-6">
      <h2 className="font-mono text-sm text-muted-foreground">{name}</h2>
      {properties && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t("harness.properties")}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
            {JSON.stringify(properties, null, 2)}
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
      <Fixture name="scene-lighthouse-arrival" entry={lighthouseFixture as EntryFixture} />
      <Fixture name="scene-smuggler-captured" entry={smugglersFixture as EntryFixture} />
      <Fixture name="degrade-beispiele (inline)" entry={{ body: degradeSample }} />
    </div>
  );
}
