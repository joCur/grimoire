// Parser tests run against the REAL fixture campaign in /examples/beispiel —
// the fixtures are the format contract (CLAUDE.md: never mock, never "clean up").
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  kindFromPath,
  locationSummary,
  npcSummary,
  parseMarkdown,
  sceneSummary,
  sessionSummary,
} from "../src/parse";
import type {
  CampaignProperties,
  NpcProperties,
  SceneProperties,
  SessionProperties,
} from "../src/types";

const FIXTURES = join(import.meta.dir, "..", "..", "examples", "beispiel");

/** Load a fixture by campaign-relative path and parse it. */
function loadFixture(relPath: string) {
  const raw = readFileSync(join(FIXTURES, relPath), "utf8");
  return parseMarkdown(raw, relPath, 1234);
}

// --- kindFromPath -------------------------------------------------------------

describe("kindFromPath", () => {
  test("detects every fixture file's kind correctly", () => {
    expect(kindFromPath("npcs/fenn.md")).toBe("npc");
    expect(kindFromPath("npcs/jorna.md")).toBe("npc");
    expect(kindFromPath("locations/leuchtturm.md")).toBe("location");
    expect(kindFromPath("sessions/2026-01-15.md")).toBe("session");
    expect(kindFromPath("inbox.md")).toBe("inbox");
    expect(kindFromPath("glossary.md")).toBe("glossary");
    expect(kindFromPath("01-salzhafen/_chapter.md")).toBe("chapter");
    expect(kindFromPath("01-salzhafen/hafen/ankunft-leuchtturm.md")).toBe("scene");
    expect(kindFromPath("01-salzhafen/hafen/von-schmugglern-erwischt.md")).toBe("scene");
    expect(kindFromPath("_campaign.md")).toBe("campaign");
  });

  test("_campaign.md is campaign metadata in the campaign ROOT only", () => {
    expect(kindFromPath("_campaign.md")).toBe("campaign");
    expect(kindFromPath("./_campaign.md")).toBe("campaign");
    // Deeper occurrences keep the kind their depth already gave them — the
    // new rule is additive and changes nothing below the root.
    expect(kindFromPath("01-salzhafen/_campaign.md")).toBe("scene");
    expect(kindFromPath("01-salzhafen/hafen/_campaign.md")).toBe("scene");
    // …and _chapter.md detection is untouched.
    expect(kindFromPath("01-salzhafen/_chapter.md")).toBe("chapter");
    expect(kindFromPath("01-salzhafen/hafen/_chapter.md")).toBe("chapter");
  });

  test("scene directly in a chapter directory (no location slug)", () => {
    expect(kindFromPath("01-salzhafen/prolog.md")).toBe("scene");
  });

  test("everything else is unknown", () => {
    expect(kindFromPath("README.md")).toBe("unknown"); // root-level stray md
    expect(kindFromPath("notes.md")).toBe("unknown");
    expect(kindFromPath(".DS_Store")).toBe("unknown");
    expect(kindFromPath("01-salzhafen/hafen/map.png")).toBe("unknown");
    expect(kindFromPath("")).toBe("unknown");
  });

  test("path normalization: leading ./ and backslashes", () => {
    expect(kindFromPath("./npcs/fenn.md")).toBe("npc");
    expect(kindFromPath("01-salzhafen\\hafen\\szene.md")).toBe("scene");
  });

  // The API's ADDRESSES carry no extension since issue #79, while the
  // importer still hands in `.md` file paths. Both spellings answer the same
  // kind, and any OTHER extension is still "not one of ours".
  test("addresses without the .md extension answer the same kind", () => {
    expect(kindFromPath("npcs/fenn")).toBe("npc");
    expect(kindFromPath("locations/leuchtturm")).toBe("location");
    expect(kindFromPath("sessions/2026-01-15")).toBe("session");
    expect(kindFromPath("_campaign")).toBe("campaign");
    expect(kindFromPath("inbox")).toBe("inbox");
    expect(kindFromPath("glossary")).toBe("glossary");
    expect(kindFromPath("01-salzhafen/_chapter")).toBe("chapter");
    expect(kindFromPath("01-salzhafen/prolog")).toBe("scene");
    expect(kindFromPath("01-salzhafen/hafen/ankunft-leuchtturm")).toBe("scene");
    // Not addresses at all.
    expect(kindFromPath("notes")).toBe("unknown");
    expect(kindFromPath("01-salzhafen/hafen/map.png")).toBe("unknown");
    expect(kindFromPath("01-salzhafen/hafen/notizen.txt")).toBe("unknown");
  });
});

// --- parseMarkdown against real fixtures ---------------------------------------

describe("parseMarkdown: scene fixture (ankunft-leuchtturm.md)", () => {
  const f = loadFixture("01-salzhafen/hafen/ankunft-leuchtturm.md");
  const fm = f.properties as SceneProperties;

  test("kind, path and rev are carried through", () => {
    expect(f.kind).toBe("scene");
    expect(f.path).toBe("01-salzhafen/hafen/ankunft-leuchtturm.md");
    expect(f.rev).toBe(1234);
  });

  test("properties is fully typed-parsed", () => {
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

  test("body excludes the properties block but keeps the markdown", () => {
    expect(f.body).not.toContain("id: lighthouse-arrival");
    expect(f.body).toContain("## Flow");
    expect(f.body).toContain("> [!readaloud]");
  });
});

describe("parseMarkdown: session fixture (2026-01-15.md) — YAML date footgun", () => {
  const f = loadFixture("sessions/2026-01-15.md");
  const fm = f.properties as SessionProperties;

  test("id is the string '2026-01-15', not a Date", () => {
    expect(typeof fm.id).toBe("string");
    expect(fm.id).toBe("2026-01-15");
  });

  test("started/ended are strings in yyyy-mm-ddTHH:MM format", () => {
    expect(typeof fm.started).toBe("string");
    expect(fm.started).toBe("2026-01-15T19:30");
    expect(typeof fm.ended).toBe("string");
    expect(fm.ended).toBe("2026-01-15T22:45");
  });

  test("scenes_played survives as string array", () => {
    expect(fm.scenes_played).toEqual(["lighthouse-arrival"]);
  });
});

describe("parseMarkdown: remaining fixtures", () => {
  test("npc fixture (fenn.md) incl. free-form quickstats", () => {
    const f = loadFixture("npcs/fenn.md");
    const fm = f.properties as NpcProperties;
    expect(f.kind).toBe("npc");
    expect(fm.id).toBe("fenn");
    expect(fm.name).toBe("Fenn");
    expect(fm.status).toBe("alive");
    // YAML parses `+2` as the number 2 — preserved as-is (quickstats is free-form).
    expect(fm.quickstats).toEqual({ wis: 2, insight: 2, "passive-perception": 13 });
  });

  test("location fixture (leuchtturm.md) keeps quoted roll20-page key", () => {
    const f = loadFixture("locations/leuchtturm.md");
    expect(f.kind).toBe("location");
    expect(f.properties["roll20-page"]).toBe("Leuchtturm");
    expect(f.properties.name).toBe("Der Leuchtturm von Salzhafen");
  });

  test("chapter fixture (_chapter.md)", () => {
    const f = loadFixture("01-salzhafen/_chapter.md");
    expect(f.kind).toBe("chapter");
    expect(f.properties.id).toBe("01-salzhafen");
    expect(f.properties.title).toBe("Kapitel 1: Der Leuchtturm von Salzhafen");
    expect(f.properties.status).toBe("active");
  });

  test("campaign fixture (_campaign.md)", () => {
    const f = loadFixture("_campaign.md");
    const fm = f.properties as CampaignProperties;
    expect(f.kind).toBe("campaign");
    expect(fm.id).toBe("beispiel");
    expect(fm.name).toBe("Der Leuchtturm von Salzhafen");
    expect(typeof fm.description).toBe("string");
    expect(f.body).not.toContain("id: beispiel");
    expect(f.body).toContain("Kampagnenweite Notizen");
  });

  test("inbox and glossary fixtures", () => {
    const inbox = loadFixture("inbox.md");
    expect(inbox.kind).toBe("inbox");
    expect(inbox.properties.id).toBe("inbox");
    const glossary = loadFixture("glossary.md");
    expect(glossary.kind).toBe("glossary");
    expect(glossary.properties.id).toBe("glossary");
    expect(glossary.body).toContain("lighthouse keeper → Leuchtturmwärter");
  });

  test("contingency scene fixture (von-schmugglern-erwischt.md)", () => {
    const f = loadFixture("01-salzhafen/hafen/von-schmugglern-erwischt.md");
    const fm = f.properties as SceneProperties;
    expect(fm.type).toBe("contingency");
    expect(fm.trigger).toContain("Auskundschaften");
    expect(fm.handouts).toEqual([]);
    expect(f.body).toContain("## If: sie geben zu, für Jorna zu arbeiten");
  });
});

// --- degradation semantics ------------------------------------------------------

describe("parseMarkdown: degradation (never throws)", () => {
  test("invalid YAML -> properties {} except id fallback, entire raw as body", () => {
    const raw = "---\nfoo: [unclosed\n---\n\n## Flow\n\nText.";
    const f = parseMarkdown(raw, "01-salzhafen/hafen/kaputt.md", 1);
    expect(f.properties.id).toBe("kaputt"); // filename fallback
    expect(f.properties.foo).toBeUndefined();
    expect(f.body).toBe(raw); // entire raw content, properties block included
  });

  test("unclosed quote in YAML does not throw either", () => {
    const raw = '---\nname: "unclosed\n---\nbody';
    const f = parseMarkdown(raw, "npcs/tab.md", 1);
    expect(f.properties.name).toBe("tab"); // name fallback to id (filename)
    expect(f.body).toBe(raw);
  });

  test("non-mapping properties (bare string) degrades like broken YAML", () => {
    const raw = "---\njust a string\n---\nbody";
    const f = parseMarkdown(raw, "npcs/weird.md", 1);
    expect(f.properties.id).toBe("weird");
    expect(f.body).toBe(raw);
  });

  test("file without properties: whole content is body, id from filename", () => {
    const raw = "# Nur Text\n\nKein Properties.";
    const f = parseMarkdown(raw, "01-salzhafen/hafen/roh.md", 1);
    expect(f.properties.id).toBe("roh");
    expect(f.body).toBe(raw);
  });

  test("unknown properties keys are preserved verbatim", () => {
    const raw = "---\nid: x\nmood: grim\ncustom-list: [a, b]\n---\nbody";
    const f = parseMarkdown(raw, "01-salzhafen/x.md", 1);
    expect(f.properties.mood).toBe("grim");
    expect(f.properties["custom-list"]).toEqual(["a", "b"]);
  });

  test("dates are normalized recursively, incl. arrays and nested objects", () => {
    const raw =
      "---\nid: x\nwhen: 2026-08-19\nexact: 2026-08-19T19:32:07\ndates: [2026-01-01, 2026-01-02T08:05:00]\nnested: { at: 2026-03-04 }\n---\n";
    const f = parseMarkdown(raw, "sessions/x.md", 1);
    expect(f.properties.when).toBe("2026-08-19");
    // Non-zero SECONDS survive (issue #40 AK8: the session's `pauses` are
    // second-precise); a `:00` still normalizes away.
    expect(f.properties.exact).toBe("2026-08-19T19:32:07");
    expect(f.properties.dates).toEqual(["2026-01-01", "2026-01-02T08:05"]);
    expect(f.properties.nested).toEqual({ at: "2026-03-04" });
  });

  test("id fallback from filename; title/name fall back to the id", () => {
    const scene = parseMarkdown("---\nstatus: draft\n---\nbody", "01-x/hafen/meine-szene.md", 1);
    expect(scene.properties.id).toBe("meine-szene");
    expect(scene.properties.title).toBe("meine-szene");

    const npc = parseMarkdown("---\nrole: Wache\n---\n", "npcs/wache.md", 1);
    expect(npc.properties.id).toBe("wache");
    expect(npc.properties.name).toBe("wache");

    const withId = parseMarkdown("---\nid: real-id\n---\n", "locations/ort.md", 1);
    expect(withId.properties.name).toBe("real-id");

    // A campaign file follows the npc/location rule: no `name` -> the id.
    const campaign = parseMarkdown("---\nid: beispiel\n---\n", "_campaign.md", 1);
    expect(campaign.kind).toBe("campaign");
    expect(campaign.properties.name).toBe("beispiel");
  });

  test("broken campaign properties degrades instead of throwing", () => {
    const raw = "---\nname: [unclosed\n---\n\nNotizen.";
    const f = parseMarkdown(raw, "_campaign.md", 1);
    expect(f.kind).toBe("campaign");
    expect(f.properties.id).toBe("_campaign"); // file-stem fallback
    expect(f.properties.description).toBeUndefined();
    expect(f.body).toBe(raw);
  });

  test("campaign keys beyond id/name/description are preserved verbatim", () => {
    const f = parseMarkdown(
      "---\nid: beispiel\nname: Salzhafen\nsystem: D&D 5e\n---\nbody",
      "_campaign.md",
      1,
    );
    expect(f.properties.system).toBe("D&D 5e");
  });

  test("repeated parsing of the same string is stable (gray-matter cache safety)", () => {
    const raw = readFileSync(join(FIXTURES, "sessions/2026-01-15.md"), "utf8");
    const a = parseMarkdown(raw, "sessions/2026-01-15.md", 1);
    (a.properties as Record<string, unknown>).tampered = true;
    const b = parseMarkdown(raw, "sessions/2026-01-15.md", 2);
    expect(b.properties.tampered).toBeUndefined();
    expect(b.properties.started).toBe("2026-01-15T19:30");
  });
});

// --- summary builders ------------------------------------------------------------

describe("summary builders against real fixtures", () => {
  test("sceneSummary for ankunft-leuchtturm.md", () => {
    const s = sceneSummary(loadFixture("01-salzhafen/hafen/ankunft-leuchtturm.md"));
    expect(s).toEqual({
      path: "01-salzhafen/hafen/ankunft-leuchtturm.md",
      id: "lighthouse-arrival",
      title: "Ankunft am Leuchtturm",
      type: "planned",
      status: "ready",
      location: "leuchtturm",
      npcs: ["jorna"],
      tags: ["social", "travel"],
    });
  });

  test("sceneSummary passes the contingency trigger through", () => {
    const s = sceneSummary(loadFixture("01-salzhafen/hafen/von-schmugglern-erwischt.md"));
    expect(s.type).toBe("contingency");
    expect(s.trigger).toBe("Charaktere werden beim Auskundschaften der Bucht entdeckt");
  });

  test("sceneSummary trigger is undefined when the properties has none", () => {
    const s = sceneSummary(parseMarkdown("---\nid: s\n---\n", "01-x/s.md", 1));
    expect(s.trigger).toBeUndefined();
  });

  test("npcSummary for fenn.md", () => {
    const s = npcSummary(loadFixture("npcs/fenn.md"));
    expect(s).toEqual({
      path: "npcs/fenn.md",
      id: "fenn",
      name: "Fenn",
      role: "Anführer der Schmuggler in der Nordbucht",
      status: "alive",
      chapter: "01-salzhafen",
    });
  });

  test("locationSummary for leuchtturm.md", () => {
    const s = locationSummary(loadFixture("locations/leuchtturm.md"));
    expect(s).toEqual({
      path: "locations/leuchtturm.md",
      id: "leuchtturm",
      name: "Der Leuchtturm von Salzhafen",
      chapter: "01-salzhafen",
    });
  });

  test("sessionSummary for 2026-01-15.md", () => {
    const s = sessionSummary(loadFixture("sessions/2026-01-15.md"));
    expect(s).toEqual({
      path: "sessions/2026-01-15.md",
      id: "2026-01-15",
      started: "2026-01-15T19:30",
      ended: "2026-01-15T22:45",
      scenes_played: ["lighthouse-arrival"],
    });
  });
});

describe("summary builders: defensive paths (synthetic input)", () => {
  test("scalar instead of array is wrapped (npcs: fenn)", () => {
    const raw = "---\nid: s\nnpcs: fenn\ntags: combat\n---\n";
    const s = sceneSummary(parseMarkdown(raw, "01-x/s.md", 1));
    expect(s.npcs).toEqual(["fenn"]);
    expect(s.tags).toEqual(["combat"]);
  });

  test("non-string array members are String()ed, null members dropped", () => {
    const raw = "---\nid: s\nnpcs: [1, true, ~, fenn]\n---\n";
    const s = sceneSummary(parseMarkdown(raw, "01-x/s.md", 1));
    expect(s.npcs).toEqual(["1", "true", "fenn"]);
  });

  test("missing array fields always come back as empty arrays", () => {
    const s = sceneSummary(parseMarkdown("---\nid: s\n---\n", "01-x/s.md", 1));
    expect(s.npcs).toEqual([]);
    expect(s.tags).toEqual([]);
    const sess = sessionSummary(parseMarkdown("---\nid: x\n---\n", "sessions/x.md", 1));
    expect(sess.scenes_played).toEqual([]);
  });

  test("missing type/status fall back to planned/draft; npc status to unknown", () => {
    const s = sceneSummary(parseMarkdown("---\nid: s\n---\n", "01-x/s.md", 1));
    expect(s.type).toBe("planned");
    expect(s.status).toBe("draft");
    const n = npcSummary(parseMarkdown("---\nid: n\n---\n", "npcs/n.md", 1));
    expect(n.status).toBe("unknown");
  });

  test("unknown enum values pass through untouched (degrade, don't validate)", () => {
    const s = sceneSummary(parseMarkdown("---\nid: s\nstatus: irgendwas\n---\n", "01-x/s.md", 1));
    expect(s.status).toBe("irgendwas");
  });

  test("numeric scalars coerce to strings; objects in scalar slots are dropped", () => {
    const raw = "---\nid: 42\nlocation: 7\nrole: { nested: nope }\n---\n";
    const s = sceneSummary(parseMarkdown(raw, "01-x/s.md", 1));
    expect(s.id).toBe("42");
    expect(s.location).toBe("7");
    const n = npcSummary(parseMarkdown(raw, "npcs/s.md", 1));
    expect(n.role).toBeUndefined();
  });

  test("scenes_played with date members normalizes to strings", () => {
    const raw = "---\nid: x\nscenes_played: 2026-01-01\n---\n";
    const s = sessionSummary(parseMarkdown(raw, "sessions/x.md", 1));
    expect(s.scenes_played).toEqual(["2026-01-01"]);
  });
});
