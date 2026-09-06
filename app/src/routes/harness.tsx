// "/dev/markdown" — dev harness: renders the markdown pipeline against the
// two reference fixtures from examples/ (imported via ?raw), so the callout
// renderer is visually checkable without a running server. CLAUDE.md names
// exactly these two files as the check for renderer changes.

import lighthouseRaw from "../../../examples/beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md?raw";
import smugglersRaw from "../../../examples/beispiel/01-salzhafen/hafen/von-schmugglern-erwischt.md?raw";

import { Markdown } from "@/markdown/Markdown";

/** Splits a raw file into its properties block and the markdown body. */
function splitProperties(raw: string): { properties: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { properties: "", body: raw };
  return { properties: match[1] ?? "", body: raw.slice(match[0].length) };
}

// Extra snippet exercising the degrade paths that the fixtures do not cover.
const degradeSample = `## If: die Gruppe flieht sofort

Ein Absatz innerhalb der Verzweigung.

> [!homebrew] Unbekannter Callout — muss als normales Zitat erscheinen.

## Ganz normale Überschrift

Text nach der Verzweigung, außerhalb des details-Elements.
`;

function Fixture({ name, raw }: { name: string; raw: string }) {
  const { properties, body } = splitProperties(raw);
  return (
    <section className="space-y-3 border-t pt-6">
      <h2 className="font-mono text-sm text-muted-foreground">{name}</h2>
      {properties && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Eigenschaften anzeigen
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
            {properties}
          </pre>
        </details>
      )}
      <Markdown>{body}</Markdown>
    </section>
  );
}

export function HarnessRoute() {
  return (
    <div className="mx-auto max-w-[760px] space-y-8 px-7 py-10">
      <header>
        <h1 className="text-lg font-semibold">Markdown-Harness</h1>
        <p className="text-sm text-muted-foreground">
          Rendert die Referenz-Fixtures aus examples/ ohne laufenden Server.
        </p>
      </header>
      <Fixture name="01-salzhafen/hafen/ankunft-leuchtturm.md" raw={lighthouseRaw} />
      <Fixture name="01-salzhafen/hafen/von-schmugglern-erwischt.md" raw={smugglersRaw} />
      <Fixture name="degrade-beispiele (inline)" raw={degradeSample} />
    </div>
  );
}
