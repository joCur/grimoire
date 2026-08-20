// Unit tests for the generator view's derivations (issue #12): the
// new-chapter id (numeric prefix + kebab slug), the client-side frontmatter
// split the review preview needs, the German labels — and (issue #19) which
// state the server's job puts the view in.

import { describe, expect, test } from "bun:test";

import {
  applySummary,
  contextHint,
  countLabel,
  generatePhase,
  jobErrorBody,
  markdownBody,
  newChapterId,
  nextChapterPrefix,
  slugify,
  stringField,
  stringList,
  usageLabel,
} from "./generate";

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

describe("markdownBody", () => {
  const file = ["---", "id: kai", "title: Am Kai", "---", "", "## Flow", "", "Text.", ""].join("\n");

  test("splits the frontmatter block off", () => {
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
  test("countLabel picks the German plural", () => {
    expect(countLabel(1, "Szene", "Szenen")).toBe("1 Szene");
    expect(countLabel(0, "Szene", "Szenen")).toBe("0 Szenen");
    expect(countLabel(3, "Stub", "Stubs")).toBe("3 Stubs");
  });

  test("applySummary reads like the prototype's button", () => {
    expect(applySummary(1, 1)).toBe("1 Szene · 1 Stub");
    expect(applySummary(2, 0)).toBe("2 Szenen · 0 Stubs");
  });

  test("contextHint names what the prompt carries", () => {
    expect(contextHint(2, 1, true)).toBe("2 NPCs · 1 Ort · Glossar");
    expect(contextHint(1, 0, false)).toBe("1 NPC · 0 Orte · kein Glossar");
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
    expect(usageLabel({ inputTokens: 11400, outputTokens: 1000, attempts: 1 })).toBe(
      "~12.400 Tokens · 1 Versuch",
    );
    expect(usageLabel({ inputTokens: 40000, outputTokens: 1234, attempts: 3 })).toBe(
      "~41.234 Tokens · 3 Versuche",
    );
    // below the grouping threshold, and the plural of 0
    expect(usageLabel({ inputTokens: 800, outputTokens: 20, attempts: 2 })).toBe(
      "~820 Tokens · 2 Versuche",
    );
    expect(usageLabel({ inputTokens: 1000000, outputTokens: 0, attempts: 1 })).toBe(
      "~1.000.000 Tokens · 1 Versuch",
    );
  });

  test("nothing to show without usable numbers", () => {
    expect(usageLabel(undefined)).toBeUndefined();
    expect(usageLabel(null)).toBeUndefined();
    expect(usageLabel("12400")).toBeUndefined();
    expect(usageLabel([1, 2])).toBeUndefined();
    expect(usageLabel({})).toBeUndefined();
    expect(usageLabel({ inputTokens: 0, outputTokens: 0, attempts: 0 })).toBeUndefined();
  });

  test("survives a partial usage object instead of printing NaN", () => {
    expect(usageLabel({ attempts: 1 })).toBe("~0 Tokens · 1 Versuch");
    expect(usageLabel({ inputTokens: 500, attempts: "viele" })).toBe("~500 Tokens · 0 Versuche");
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
      validationErrors: ['scene "x.md": "status" must be "draft"'],
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
