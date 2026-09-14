// Unit tests for the generator view's derivations (issue #12): the
// new-chapter id (numeric prefix + kebab slug), the client-side properties
// split the review preview needs, the German labels — and (issue #19) which
// state the server's job puts the view in.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";
import {
  applySummary,
  chapterIdError,
  chapterIdValue,
  contextHint,
  knowledgeHint,
  generatePhase,
  jobErrorBody,
  jobMode,
  markdownBody,
  newChapterId,
  nextChapterPrefix,
  npcIdError,
  restoredMode,
  slugify,
  stringField,
  stringList,
  usageLabel,
} from "./generate";

// The copy comes from the catalog and the translator is passed in (issue
// #69) — so a test says which language it asserts.
const t = translator("de");
const tEn = translator("en");

describe("slugify", () => {
  test("kebab-cases a German chapter title", () => {
    expect(slugify("Die Schmugglerbucht")).toBe("die-schmugglerbucht");
  });

  test("transliterates umlauts and ß instead of dropping them", () => {
    expect(slugify("Über den Fährmann, groß")).toBe("ueber-den-faehrmann-gross");
    expect(slugify("Öde Höhle")).toBe("oede-hoehle");
  });

  test("strips accents and punctuation, collapses separators", () => {
    expect(slugify("Café  am –– Kai!")).toBe("cafe-am-kai");
    expect(slugify("Kapitel 2: Der Turm")).toBe("kapitel-2-der-turm");
  });

  test("no usable characters yields an empty slug", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("…!?")).toBe("");
  });
});

describe("nextChapterPrefix", () => {
  test("first chapter of an empty campaign", () => {
    expect(nextChapterPrefix([])).toBe("01");
  });

  test("continues after the highest existing prefix", () => {
    expect(nextChapterPrefix(["01-salzhafen"])).toBe("02");
    expect(nextChapterPrefix(["01-a", "02-b", "03-c"])).toBe("04");
  });

  test("gaps and unordered ids do not lower the number", () => {
    expect(nextChapterPrefix(["03-c", "01-a"])).toBe("04");
    expect(nextChapterPrefix(["09-x"])).toBe("10");
  });

  test("keeps the widest existing padding", () => {
    expect(nextChapterPrefix(["001-a", "002-b"])).toBe("003");
  });

  test("chapters without a numeric prefix are ignored", () => {
    expect(nextChapterPrefix(["prolog", "anhang"])).toBe("01");
    expect(nextChapterPrefix(["prolog", "07-see"])).toBe("08");
  });
});

describe("newChapterId", () => {
  test("prefix and slug form the directory name", () => {
    expect(newChapterId("Die Schmugglerbucht", ["01-salzhafen"])).toBe("02-die-schmugglerbucht");
  });

  test("undefined while the title has no slug yet", () => {
    expect(newChapterId("", ["01-salzhafen"])).toBeUndefined();
    expect(newChapterId("  ", [])).toBeUndefined();
  });
});

describe("chapterIdError", () => {
  test("accepts kebab ids with and without a number prefix", () => {
    expect(chapterIdError("03-schmugglerbucht", t)).toBeUndefined();
    expect(chapterIdError("schmugglerbucht", t)).toBeUndefined();
    expect(chapterIdError("prolog", t)).toBeUndefined();
    expect(chapterIdError("007", t)).toBeUndefined();
  });

  test("rejects an empty id", () => {
    expect(chapterIdError("", t)).toBe("Kapitel-id fehlt.");
  });

  test("rejects path separators", () => {
    expect(chapterIdError("a/b", t)).toContain("Schrägstriche");
    expect(chapterIdError("a\\b", t)).toContain("Schrägstriche");
    expect(chapterIdError("/absolut", t)).toContain("Schrägstriche");
  });

  test("rejects traversal and hidden segments", () => {
    expect(chapterIdError("..", t)).toContain("..");
    expect(chapterIdError("a..b", t)).toContain("..");
    expect(chapterIdError(".versteckt", t)).toContain("Punkt am Anfang");
  });

  test("rejects whitespace anywhere", () => {
    expect(chapterIdError("03 schmugglerbucht", t)).toContain("Leerzeichen");
    expect(chapterIdError(" 03-bucht", t)).toContain("Leerzeichen");
    expect(chapterIdError("03-bucht ", t)).toContain("Leerzeichen");
    expect(chapterIdError("   ", t)).toContain("Leerzeichen");
    expect(chapterIdError("03-bucht\t", t)).toContain("Leerzeichen");
  });

  test("rejects anything outside lowercase kebab — no silent rewrite", () => {
    const charset = "Nur Kleinbuchstaben, Ziffern und Bindestriche.";
    expect(chapterIdError("03-Schmugglerbucht", t)).toBe(charset);
    expect(chapterIdError("03-schmüggler", t)).toBe(charset);
    expect(chapterIdError("03_bucht", t)).toBe(charset);
    expect(chapterIdError("bucht.md", t)).toBe(charset);
    expect(chapterIdError("bucht\0", t)).toBe(charset);
  });

  test("rejects the reserved campaign directories", () => {
    expect(chapterIdError("npcs", t)).toContain("reserviert");
    expect(chapterIdError("locations", t)).toContain("reserviert");
    expect(chapterIdError("sessions", t)).toContain("reserviert");
    // Only the exact names are reserved.
    expect(chapterIdError("02-sessions-am-kai", t)).toBeUndefined();
  });
});

describe("chapterIdValue", () => {
  test("follows the title while the field is untouched", () => {
    expect(chapterIdValue("02-die-schmugglerbucht", undefined)).toBe("02-die-schmugglerbucht");
    expect(chapterIdValue(undefined, undefined)).toBe("");
  });

  test("a manual value wins over the suggestion", () => {
    expect(chapterIdValue("02-die-schmugglerbucht", "03-bucht")).toBe("03-bucht");
    // …even when the title yields no suggestion at all.
    expect(chapterIdValue(undefined, "03-bucht")).toBe("03-bucht");
  });

  test("the suggestion follows the title only until the first manual edit", () => {
    const ids = ["01-salzhafen"];
    // Typing the title: the field mirrors the suggestion.
    let manual: string | undefined;
    expect(chapterIdValue(newChapterId("Die Bucht", ids), manual)).toBe("02-die-bucht");
    // The DM edits the id — from here the title no longer moves it.
    manual = "07-bucht";
    expect(chapterIdValue(newChapterId("Die Bucht", ids), manual)).toBe("07-bucht");
    expect(chapterIdValue(newChapterId("Ganz anderer Titel", ids), manual)).toBe("07-bucht");
    // Clearing the field (the view maps "" back to undefined) hands it back.
    manual = undefined;
    expect(chapterIdValue(newChapterId("Ganz anderer Titel", ids), manual)).toBe(
      "02-ganz-anderer-titel",
    );
  });
});

describe("markdownBody", () => {
  const file = ["---", "id: kai", "title: Am Kai", "---", "", "## Flow", "", "Text.", ""].join("\n");

  test("splits the properties block off", () => {
    expect(markdownBody(file)).toBe("## Flow\n\nText.\n");
  });

  test("keeps everything after the FIRST closing marker", () => {
    const withRule = "---\nid: x\n---\n\nText.\n\n---\n\nMehr.\n";
    expect(markdownBody(withRule)).toBe("Text.\n\n---\n\nMehr.\n");
  });

  test("degrades: no block, or an unclosed one, is all body", () => {
    expect(markdownBody("## Nur Text\n")).toBe("## Nur Text\n");
    expect(markdownBody("---\nid: x\n\nkein Ende\n")).toBe("---\nid: x\n\nkein Ende\n");
    expect(markdownBody("")).toBe("");
  });

  test("handles CRLF files", () => {
    expect(markdownBody("---\r\nid: x\r\n---\r\n\r\nText.\r\n")).toBe("Text.\r\n");
  });
});

describe("labels", () => {
  // What countLabel used to prove — a count and its noun agree — is an ICU
  // plural inside the catalog keys now, so it is asserted through the two
  // functions that consume them.
  test("applySummary reads like the prototype's button", () => {
    expect(applySummary(1, 1, t)).toBe("1 Szene · 1 Stub");
    expect(applySummary(2, 0, t)).toBe("2 Szenen · 0 Stubs");
    expect(applySummary(0, 3, t)).toBe("0 Szenen · 3 Stubs");
  });

  test("contextHint names the two counts the tree carries", () => {
    expect(contextHint(2, 1, t)).toBe("2 NPCs \u00b7 1 Ort");
    expect(contextHint(1, 0, t)).toBe("1 NPC \u00b7 0 Orte");
  });

  test("knowledgeHint COUNTS the knowledge entries (issue #53 AK5)", () => {
    // A count, not a yes/no: the DM comes here right after writing a rule and
    // the number is what confirms it travels. Zero says so in words — the
    // line has to read as a sentence either way.
    expect(knowledgeHint(0, t)).toBe("kein Kampagnenwissen");
    expect(knowledgeHint(1, t)).toBe("1 Wissens-Eintrag");
    expect(knowledgeHint(3, t)).toBe("3 Wissens-Eintr\u00e4ge");
  });
});

describe("stringList", () => {
  test("keeps strings, drops everything else", () => {
    expect(stringList(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(stringList(undefined)).toEqual([]);
    expect(stringList("a")).toEqual([]);
  });
});

describe("stringField", () => {
  test("keeps a non-empty string, drops everything else", () => {
    expect(stringField("Rohantwort")).toBe("Rohantwort");
    expect(stringField("")).toBeUndefined();
    expect(stringField(42)).toBeUndefined();
    expect(stringField(undefined)).toBeUndefined();
  });
});

describe("usageLabel", () => {
  test("sums the tokens and groups them the German way", () => {
    expect(usageLabel({ inputTokens: 11400, outputTokens: 1000, attempts: 1 }, t)).toBe(
      "~12.400 Tokens · 1 Versuch",
    );
    expect(usageLabel({ inputTokens: 40000, outputTokens: 1234, attempts: 3 }, t)).toBe(
      "~41.234 Tokens · 3 Versuche",
    );
    // below the grouping threshold, and the plural of 0
    expect(usageLabel({ inputTokens: 800, outputTokens: 20, attempts: 2 }, t)).toBe(
      "~820 Tokens · 2 Versuche",
    );
    expect(usageLabel({ inputTokens: 1000000, outputTokens: 0, attempts: 1 }, t)).toBe(
      "~1.000.000 Tokens · 1 Versuch",
    );
  });

  // The separator is catalog data (generate.usage.group), so the other
  // language has to be proven too — not just the German rule.
  test("the thousands separator comes from the catalog", () => {
    expect(usageLabel({ inputTokens: 11400, outputTokens: 1000, attempts: 1 }, tEn)).toBe(
      "~12,400 tokens · 1 attempt",
    );
    expect(usageLabel({ inputTokens: 1000000, outputTokens: 0, attempts: 3 }, tEn)).toBe(
      "~1,000,000 tokens · 3 attempts",
    );
  });

  test("nothing to show without usable numbers", () => {
    expect(usageLabel(undefined, t)).toBeUndefined();
    expect(usageLabel(null, t)).toBeUndefined();
    expect(usageLabel("12400", t)).toBeUndefined();
    expect(usageLabel([1, 2], t)).toBeUndefined();
    expect(usageLabel({}, t)).toBeUndefined();
    expect(usageLabel({ inputTokens: 0, outputTokens: 0, attempts: 0 }, t)).toBeUndefined();
  });

  test("survives a partial usage object instead of printing NaN", () => {
    expect(usageLabel({ attempts: 1 }, t)).toBe("~0 Tokens · 1 Versuch");
    expect(usageLabel({ inputTokens: 500, attempts: "viele" }, t)).toBe("~500 Tokens · 0 Versuche");
  });
});

// --- the view's state, derived from the server's job (issue #19) -----------

describe("generatePhase", () => {
  const base = { applied: false, starting: false, jobChecked: true };

  test("no job: the input form", () => {
    expect(generatePhase(base)).toBe("input");
  });

  test("before the first job lookup answers, neither form nor spinner", () => {
    expect(generatePhase({ ...base, jobChecked: false })).toBe("checking");
  });

  test("the server's job decides: running -> working, done -> review", () => {
    expect(generatePhase({ ...base, jobStatus: "running" })).toBe("working");
    expect(generatePhase({ ...base, jobStatus: "done" })).toBe("review");
  });

  test("a failed job belongs to the input state — its error block sits there", () => {
    expect(generatePhase({ ...base, jobStatus: "failed" })).toBe("input");
  });

  test("a start in flight is already the working state", () => {
    // …even before the job shows up in the query (and before it was checked)
    expect(generatePhase({ ...base, starting: true })).toBe("working");
    expect(generatePhase({ ...base, starting: true, jobChecked: false })).toBe("working");
  });

  test("a finished apply wins over everything the job still says", () => {
    expect(generatePhase({ ...base, applied: true, jobStatus: "done" })).toBe("done");
    expect(generatePhase({ ...base, applied: true, starting: true })).toBe("done");
  });
});

describe("jobErrorBody", () => {
  const failed = (error: unknown) =>
    ({
      id: "j1",
      campaign: "beispiel",
      chapter: "01-salzhafen",
      status: "failed",
      startedAt: "2026-08-20T10:00:00.000Z",
      draftEdits: {},
      error,
    }) as never;

  test("hands back the error body of a failed job unchanged", () => {
    const body = {
      error: "generation failed mechanical validation after retries",
      validationErrors: ['scene "x": "status" must be "draft"'],
      rawReply: "…",
      usage: { inputTokens: 1, outputTokens: 2, attempts: 2 },
    };
    expect(jobErrorBody(failed({ status: 422, body }))).toEqual(body);
  });

  test("nothing for a job that is not failed, or has no usable body", () => {
    expect(jobErrorBody(undefined)).toBeUndefined();
    expect(jobErrorBody(null)).toBeUndefined();
    expect(jobErrorBody(failed(undefined))).toBeUndefined();
    expect(jobErrorBody(failed({ status: 500, body: "kaputt" }))).toBeUndefined();
    expect(
      jobErrorBody({
        id: "j2",
        campaign: "beispiel",
        chapter: "01-salzhafen",
        status: "running",
        startedAt: "2026-08-20T10:00:00.000Z",
        draftEdits: {},
      }),
    ).toBeUndefined();
  });
});

// --- generator mode (issue #21) ---------------------------------------------

describe("jobMode", () => {
  const job = (kind?: string) =>
    ({
      id: "j1",
      campaign: "beispiel",
      status: "done",
      startedAt: "2026-08-20T10:00:00.000Z",
      draftEdits: {},
      ...(kind === undefined ? {} : { kind }),
    }) as never;

  test("an npc job is npc mode", () => {
    expect(jobMode(job("npc"))).toBe("npc");
  });

  test("everything else is scene mode — also a payload without kind", () => {
    expect(jobMode(job("scene"))).toBe("scene");
    expect(jobMode(job())).toBe("scene");
    expect(jobMode(job("etwas-neues"))).toBe("scene");
    expect(jobMode(null)).toBe("scene");
    expect(jobMode(undefined)).toBe("scene");
  });
});

describe("restoredMode", () => {
  const job = (kind: "scene" | "npc") =>
    ({
      id: "j1",
      campaign: "beispiel",
      kind,
      status: "running",
      startedAt: "2026-08-20T10:00:00.000Z",
      draftEdits: {},
    }) as never;

  test("a job that exists decides the mode — in both directions", () => {
    expect(restoredMode("scene", job("npc"))).toBe("npc");
    expect(restoredMode("npc", job("scene"))).toBe("scene");
  });

  test("no job leaves the DM's own choice alone", () => {
    // applying/discarding an npc run must not throw the view back to scenes
    expect(restoredMode("npc", null)).toBe("npc");
    expect(restoredMode("npc", undefined)).toBe("npc");
    expect(restoredMode("scene", null)).toBe("scene");
  });
});

describe("npcIdError", () => {
  test("an empty field is not an error — it means 'the model chooses'", () => {
    expect(npcIdError("", [], t)).toBeUndefined();
  });

  test("accepts kebab ids", () => {
    expect(npcIdError("grella", [], t)).toBeUndefined();
    expect(npcIdError("die-graue-witwe", [], t)).toBeUndefined();
    expect(npcIdError("wache-2", [], t)).toBeUndefined();
  });

  test("rejects what the server would reject", () => {
    expect(npcIdError("Grella", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("die graue", [], t)).toContain("Leerzeichen");
    expect(npcIdError("npcs/grella", [], t)).toContain("Schrägstriche");
    expect(npcIdError("grella_2", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("-grella", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("gräfin", [], t)).toContain("Kleinbuchstaben");
  });

  test("an id whose file exists is named as such — the server would 409", () => {
    expect(npcIdError("fenn", ["fenn", "jorna"], t)).toContain("existiert schon");
    expect(npcIdError("grella", ["fenn", "jorna"], t)).toBeUndefined();
  });
});
