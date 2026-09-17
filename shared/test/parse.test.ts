// The generator's draft parser: one markdown text, an address, and the
// properties/body pair the store speaks.
//
// The input here is written out in the test rather than loaded from anywhere,
// because that IS the real input: a draft is what a model just answered, and
// it exists nowhere else. What the tests pin is the DEGRADE rule (ADR #1) —
// every shape of odd answer has to come back as something the caller can
// look at and refuse, never as a throw.

import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../src/parse";
import type {
  CampaignProperties,
  NpcProperties,
  SceneProperties,
  SessionProperties,
} from "../src/types";

/** A draft as the model answers it: properties block, then the body. */
function draft(properties: string, body: string): string {
  return `---\n${properties}---\n${body}`;
}

describe("parseMarkdown: a scene draft", () => {
  const raw = draft(
    [
      "id: lighthouse-arrival",
      "title: Ankunft am Leuchtturm",
      "type: planned",
      "chapter: 01-salzhafen",
      "location: leuchtturm",
      "npcs: [jorna]",
      "handouts: [Karte von Salzhafen]",
      "tags: [social, travel]",
      "status: ready",
    ].join("\n") + "\n",
    "\n## Flow\n\n> [!readaloud] Der Turm ragt schwarz gegen den Abendhimmel auf.\n",
  );
  const f = parseMarkdown(raw, "01-salzhafen/leuchtturm/lighthouse-arrival", 1234);
  const fm = f.properties as SceneProperties;

  test("kind comes from the ADDRESS, and path and rev are carried through", () => {
    expect(f.kind).toBe("scene");
    expect(f.path).toBe("01-salzhafen/leuchtturm/lighthouse-arrival");
    expect(f.rev).toBe(1234);
  });

  test("every contract field comes apart, lists included", () => {
    expect(fm.id).toBe("lighthouse-arrival");
    expect(fm.title).toBe("Ankunft am Leuchtturm");
    expect(fm.type).toBe("planned");
    expect(fm.chapter).toBe("01-salzhafen");
    expect(fm.location).toBe("leuchtturm");
    expect(fm.npcs).toEqual(["jorna"]);
    expect(fm.handouts).toEqual(["Karte von Salzhafen"]);
    expect(fm.tags).toEqual(["social", "travel"]);
    expect(fm.status).toBe("ready");
  });

  test("the body excludes the properties block and keeps the markdown", () => {
    expect(f.body).not.toContain("id: lighthouse-arrival");
    expect(f.body).toContain("## Flow");
    expect(f.body).toContain("> [!readaloud]");
  });
});

describe("parseMarkdown: a session draft — the YAML date footgun", () => {
  const f = parseMarkdown(
    draft(
      "id: 2026-01-15\nstarted: 2026-01-15T19:30\nended: 2026-01-15T22:45\nscenes_played: [lighthouse-arrival]\n",
      "\n## Threads\n\n- [ ] Wer bezahlt die Schmuggler?\n",
    ),
    "sessions/2026-01-15",
    1,
  );
  const fm = f.properties as SessionProperties;

  test("the id is the string '2026-01-15', not a Date", () => {
    expect(typeof fm.id).toBe("string");
    expect(fm.id).toBe("2026-01-15");
  });

  test("started/ended come back as `yyyy-mm-ddTHH:MM` strings", () => {
    expect(fm.started).toBe("2026-01-15T19:30");
    expect(fm.ended).toBe("2026-01-15T22:45");
  });

  test("scenes_played survives as a string list", () => {
    expect(fm.scenes_played).toEqual(["lighthouse-arrival"]);
  });
});

describe("parseMarkdown: the remaining kinds", () => {
  test("an npc draft, free-form quickstats included", () => {
    const f = parseMarkdown(
      draft(
        "id: fenn\nname: Fenn\nstatus: alive\nquickstats: { wis: +2, insight: +2, passive-perception: 13 }\n",
        "\n## Will\n\nDen Auftrag zu Ende bringen.\n",
      ),
      "npcs/fenn",
      1,
    );
    const fm = f.properties as NpcProperties;
    expect(f.kind).toBe("npc");
    expect(fm.name).toBe("Fenn");
    expect(fm.status).toBe("alive");
    // YAML parses `+2` as the number 2 — preserved as is, quickstats is free-form.
    expect(fm.quickstats).toEqual({ wis: 2, insight: 2, "passive-perception": 13 });
  });

  test("a location draft keeps the quoted `roll20-page` key", () => {
    const f = parseMarkdown(
      draft('id: leuchtturm\nname: Der Leuchtturm von Salzhafen\n"roll20-page": Leuchtturm\n', ""),
      "locations/leuchtturm",
      1,
    );
    expect(f.kind).toBe("location");
    expect(f.properties["roll20-page"]).toBe("Leuchtturm");
    expect(f.properties.name).toBe("Der Leuchtturm von Salzhafen");
  });

  test("a chapter draft", () => {
    const f = parseMarkdown(
      draft("id: 01-salzhafen\ntitle: Kapitel 1\nstatus: active\n", "\n## Ziel des Kapitels\n"),
      "01-salzhafen",
      1,
    );
    expect(f.kind).toBe("chapter");
    expect(f.properties.title).toBe("Kapitel 1");
    expect(f.properties.status).toBe("active");
  });

  test("a campaign draft", () => {
    const f = parseMarkdown(
      draft("id: beispiel\nname: Der Leuchtturm von Salzhafen\ndescription: Küstenfantasy\n", "\nNotizen.\n"),
      "campaign",
      1,
    );
    const fm = f.properties as CampaignProperties;
    expect(f.kind).toBe("campaign");
    expect(fm.name).toBe("Der Leuchtturm von Salzhafen");
    expect(fm.description).toBe("Küstenfantasy");
    expect(f.body).toContain("Notizen.");
  });
});

// --- degradation semantics ------------------------------------------------------

describe("parseMarkdown: degradation (never throws)", () => {
  test("invalid YAML -> properties {} except the id fallback, the whole text as body", () => {
    const raw = "---\nfoo: [unclosed\n---\n\n## Flow\n\nText.";
    const f = parseMarkdown(raw, "01-salzhafen/hafen/kaputt", 1);
    expect(f.properties.id).toBe("kaputt"); // the address's last segment
    expect(f.properties.foo).toBeUndefined();
    expect(f.body).toBe(raw); // the whole text, properties block included
  });

  test("an unclosed quote does not throw either", () => {
    const raw = '---\nname: "unclosed\n---\nbody';
    const f = parseMarkdown(raw, "npcs/tab", 1);
    expect(f.properties.name).toBe("tab"); // name falls back to the id
    expect(f.body).toBe(raw);
  });

  test("non-mapping properties (a bare string) degrades like broken YAML", () => {
    const raw = "---\njust a string\n---\nbody";
    const f = parseMarkdown(raw, "npcs/weird", 1);
    expect(f.properties.id).toBe("weird");
    expect(f.body).toBe(raw);
  });

  test("no properties block at all: the whole text is body, the id is the address", () => {
    const raw = "# Nur Text\n\nKeine Eigenschaften.";
    const f = parseMarkdown(raw, "01-salzhafen/hafen/roh", 1);
    expect(f.properties.id).toBe("roh");
    expect(f.body).toBe(raw);
  });

  test("unknown keys are preserved verbatim, for the caller to refuse", () => {
    const raw = "---\nid: x\nmood: grim\ncustom-list: [a, b]\n---\nbody";
    const f = parseMarkdown(raw, "01-salzhafen/x", 1);
    expect(f.properties.mood).toBe("grim");
    expect(f.properties["custom-list"]).toEqual(["a", "b"]);
  });

  test("dates are normalized recursively, arrays and nested objects included", () => {
    const raw =
      "---\nid: x\nwhen: 2026-08-19\nexact: 2026-08-19T19:32:07\ndates: [2026-01-01, 2026-01-02T08:05:00]\nnested: { at: 2026-03-04 }\n---\n";
    const f = parseMarkdown(raw, "sessions/x", 1);
    expect(f.properties.when).toBe("2026-08-19");
    // Non-zero SECONDS survive — a session's `pauses` are second-precise;
    // a `:00` still normalizes away.
    expect(f.properties.exact).toBe("2026-08-19T19:32:07");
    expect(f.properties.dates).toEqual(["2026-01-01", "2026-01-02T08:05"]);
    expect(f.properties.nested).toEqual({ at: "2026-03-04" });
  });

  test("the id falls back to the address; title/name fall back to the id", () => {
    const scene = parseMarkdown("---\nstatus: draft\n---\nbody", "01-x/hafen/meine-szene", 1);
    expect(scene.properties.id).toBe("meine-szene");
    expect(scene.properties.title).toBe("meine-szene");

    const npc = parseMarkdown("---\nrole: Wache\n---\n", "npcs/wache", 1);
    expect(npc.properties.id).toBe("wache");
    expect(npc.properties.name).toBe("wache");

    const withId = parseMarkdown("---\nid: real-id\n---\n", "locations/ort", 1);
    expect(withId.properties.name).toBe("real-id");

    // A campaign follows the npc/location rule: no `name` -> the id.
    const campaign = parseMarkdown("---\nid: beispiel\n---\n", "campaign", 1);
    expect(campaign.kind).toBe("campaign");
    expect(campaign.properties.name).toBe("beispiel");
  });

  test("broken campaign properties degrades instead of throwing", () => {
    const raw = "---\nname: [unclosed\n---\n\nNotizen.";
    const f = parseMarkdown(raw, "campaign", 1);
    expect(f.kind).toBe("campaign");
    expect(f.properties.id).toBe("campaign"); // the address itself
    expect(f.properties.description).toBeUndefined();
    expect(f.body).toBe(raw);
  });

  test("repeated parsing of the same text is stable (gray-matter caches)", () => {
    const raw = draft("id: 2026-01-15\nstarted: 2026-01-15T19:30\n", "\n## Threads\n");
    const a = parseMarkdown(raw, "sessions/2026-01-15", 1);
    (a.properties as Record<string, unknown>).tampered = true;
    const b = parseMarkdown(raw, "sessions/2026-01-15", 2);
    expect(b.properties.tampered).toBeUndefined();
    expect(b.properties.started).toBe("2026-01-15T19:30");
  });
});
