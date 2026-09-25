// The glossary-term resource (ADR #31): `GET/POST …/glossary-terms`,
// `GET/PATCH/DELETE …/glossary-terms/:id`, every field of a term flat —
// `{ id, term, explanation, rev }`.
//
// Watched hardest, because each is easy to get wrong:
//
//   * every term has its own guard: a stale `rev` is a 409 that carries the
//     current term, and a write of one term leaves another one's `rev` where
//     it was;
//   * a term stands in the glossary once — creating or rewording into one
//     that is there is a 409 that writes nothing;
//   * the search index follows every write, and a deleted term is no hit;
//   * the glossary's former list address names nothing.
//
// One fresh database per case, seeded from the committed fixtures
// (test/support/store.ts); the example campaign brings six terms.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GlossaryTerm } from "@grimoire/shared/glossary-term";
import type { SearchResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { glossaryText } from "../src/store/glossary-terms";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "beispiel";
const TERMS = `/api/campaigns/${CAMPAIGN}/glossary-terms`;
const KEEPER: GlossaryTerm = {
  id: "lighthouse-keeper",
  term: "lighthouse keeper",
  explanation: "Leuchtturmwärter",
  rev: 1,
};
const KEEPER_URL = `${TERMS}/${KEEPER.id}`;

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const answer = await res;
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

const listTerms = () => json<GlossaryTerm[]>(app.request(TERMS));
const readTerm = (url = KEEPER_URL) => json<GlossaryTerm>(app.request(url));

async function version(): Promise<number> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/version`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

async function searchHits(q: string): Promise<SearchResponse["results"]> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/search?q=${encodeURIComponent(q)}`);
  return ((await res.json()) as SearchResponse).results;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading glossary terms", () => {
  test("GET answers every field flat — no list around it, no guard of a list", async () => {
    expect(await readTerm()).toEqual(KEEPER);
    const terms = await listTerms();
    expect(terms).toContainEqual(KEEPER);
    expect(terms.every((term) => term.rev === 1)).toBe(true);
  });

  test("an unknown campaign or term is a 404", async () => {
    expect((await app.request("/api/campaigns/nope/glossary-terms")).status).toBe(404);
    expect((await app.request(`${TERMS}/nope`)).status).toBe(404);
  });

  test("the glossary's former list address names nothing — GET and PUT are 404", async () => {
    const url = `/api/campaigns/${CAMPAIGN}/glossary`;
    expect((await app.request(url)).status).toBe(404);
    expect((await send("PUT", url, { entries: [], rev: 1 })).status).toBe(404);
  });
});

describe("creating a glossary term", () => {
  test("POST answers the term at the end, trimmed, with a server id", async () => {
    const before = await listTerms();
    const created = await json<GlossaryTerm>(
      send("POST", TERMS, { term: "  tidal flat ", explanation: "Watt" }),
      201,
    );
    expect(created).toEqual({ id: created.id, term: "tidal flat", explanation: "Watt", rev: 1 });
    expect((await listTerms()).map((term) => term.id)).toEqual([
      ...before.map((term) => term.id),
      created.id,
    ]);
  });

  test("the explanation may be left out, and it may span lines", async () => {
    const bare = await json<GlossaryTerm>(send("POST", TERMS, { term: "cove" }), 201);
    expect(bare.explanation).toBe("");
    const long = await json<GlossaryTerm>(
      send("POST", TERMS, { term: "tide", explanation: "Gezeiten.\nZweite Zeile." }),
      201,
    );
    expect(long.explanation).toBe("Gezeiten.\nZweite Zeile.");
  });

  test("a term the glossary already has is 409 glossary_term_taken and writes nothing", async () => {
    const before = await listTerms();
    const res = await send("POST", TERMS, { term: " lighthouse keeper ", explanation: "Wärter" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "glossary_term_taken",
      term: "lighthouse keeper",
    });
    expect(await listTerms()).toEqual(before);
  });

  test("an empty term, an unknown key or a wrong value is a 400", async () => {
    const before = await listTerms();
    for (const body of [
      { term: "   " },
      { explanation: "ohne Begriff" },
      { term: "x", rev: 1 },
      { term: 7 },
    ]) {
      expect((await send("POST", TERMS, body)).status).toBe(400);
    }
    expect(await listTerms()).toEqual(before);
  });

  test("a new term is found by the search, named by its kind and id", async () => {
    const created = await json<GlossaryTerm>(
      send("POST", TERMS, { term: "Priel", explanation: "Wasserrinne im Watt" }),
      201,
    );
    expect(await searchHits("Priel")).toContainEqual(
      expect.objectContaining({ kind: "glossary-term", id: created.id, title: "Priel" }),
    );
  });
});

describe("writing a glossary term", () => {
  test("PATCH changes the named fields and moves only this term's rev", async () => {
    const written = await json<GlossaryTerm>(
      send("PATCH", KEEPER_URL, { rev: 1, explanation: "Leuchtturmwärterin" }),
    );
    expect(written).toEqual({ ...KEEPER, explanation: "Leuchtturmwärterin", rev: 2 });
    expect((await readTerm(`${TERMS}/read-aloud`)).rev).toBe(1);
  });

  test("a reworded term keeps its id, and the search follows it", async () => {
    await json(send("PATCH", KEEPER_URL, { rev: 1, term: "keeper of the light" }));
    expect((await readTerm()).term).toBe("keeper of the light");
    expect(await searchHits("keeper")).toContainEqual(
      expect.objectContaining({ kind: "glossary-term", id: KEEPER.id, title: "keeper of the light" }),
    );
  });

  test("rewording into a term another one reads is 409 glossary_term_taken", async () => {
    const res = await send("PATCH", KEEPER_URL, { rev: 1, term: "read-aloud" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("glossary_term_taken");
    expect(await readTerm()).toEqual(KEEPER);
    // Its own wording is no conflict.
    expect((await send("PATCH", KEEPER_URL, { rev: 1, term: KEEPER.term })).status).toBe(200);
  });

  test("a stale rev is 409 with the current term, and nothing is written", async () => {
    await json(send("PATCH", KEEPER_URL, { rev: 1, explanation: "Erst." }));
    const res = await send("PATCH", KEEPER_URL, { rev: 1, explanation: "Zweit." });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(2);
    expect(body.glossaryTerm).toEqual({ ...KEEPER, explanation: "Erst.", rev: 2 });
    expect((await readTerm()).explanation).toBe("Erst.");
  });

  test("force writes the named fields on top of the current term", async () => {
    await json(send("PATCH", KEEPER_URL, { rev: 1, term: "keeper" }));
    const forced = await json<GlossaryTerm>(
      send("PATCH", KEEPER_URL, { rev: 1, force: true, explanation: "Wärter" }),
    );
    expect(forced).toEqual({ ...KEEPER, term: "keeper", explanation: "Wärter", rev: 3 });
  });

  test("a field a term does not have or a wrong value is a 400 naming it", async () => {
    for (const [body, named] of [
      [{ rev: 1, kind: "fact" }, "kind"],
      [{ rev: 1, explanation: 7 }, "explanation"],
      [{ rev: 1, term: "  " }, "term"],
    ] as const) {
      const res = await send("PATCH", KEEPER_URL, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(named);
    }
    expect(await readTerm()).toEqual(KEEPER);
  });

  test("a patch without a field is nothing_to_write; an unknown term a 404", async () => {
    const empty = await send("PATCH", KEEPER_URL, { rev: 1 });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code?: string }).code).toBe("nothing_to_write");
    expect((await send("PATCH", `${TERMS}/nope`, { rev: 1, term: "x" })).status).toBe(404);
  });
});

describe("deleting a glossary term", () => {
  test("DELETE removes the term and its search hit", async () => {
    expect((await send("DELETE", KEEPER_URL, { rev: 1 })).status).toBe(204);
    expect((await listTerms()).map((term) => term.id)).not.toContain(KEEPER.id);
    expect(await searchHits("Leuchtturmwärter")).not.toContainEqual(
      expect.objectContaining({ kind: "glossary-term" }),
    );
  });

  test("a stale rev is 409 with the current term and removes nothing", async () => {
    await json(send("PATCH", KEEPER_URL, { rev: 1, explanation: "Neu." }));
    const res = await send("DELETE", KEEPER_URL, { rev: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { glossaryTerm: GlossaryTerm }).glossaryTerm.explanation).toBe(
      "Neu.",
    );
    expect((await readTerm()).explanation).toBe("Neu.");
  });

  test("an unknown term is a 404", async () => {
    expect((await send("DELETE", `${TERMS}/nope`, { rev: 1 })).status).toBe(404);
  });
});

describe("the prompt block (store/glossary-terms.ts glossaryText)", () => {
  test("one `term → explanation` line per term, each flattened to one line", async () => {
    await seedStore({
      without: {
        glossaryTerms: (await listTerms()).map((term) => term.id),
      },
      glossaryTerms: [
        { id: "keeper", term: "lighthouse keeper", explanation: "Leuchtturmwärter" },
        { id: "stil", term: "Stil", explanation: "- Englisch bleibt:\n  „check“." },
      ],
    });
    expect(await glossaryText(CAMPAIGN)).toBe(
      "- lighthouse keeper → Leuchtturmwärter\n- Stil → - Englisch bleibt: „check“.",
    );
  });

  test("no terms means no block", async () => {
    await seedStore({
      without: { glossaryTerms: (await listTerms()).map((term) => term.id) },
    });
    expect(await glossaryText(CAMPAIGN)).toBeUndefined();
  });
});

describe("glossary terms — rows, each with its own guard", () => {
  test("an emptied glossary is an empty list (200), and the DM can type it back in", async () => {
    for (const term of await listTerms()) {
      expect((await send("DELETE", `${TERMS}/${term.id}`, { rev: term.rev })).status).toBe(204);
    }
    expect(await listTerms()).toEqual([]);
    const res = await send("POST", TERMS, { term: "tide pool", explanation: "Gezeitentümpel" });
    expect(res.status).toBe(201);
    expect((await listTerms()).map(({ term, explanation }) => ({ term, explanation }))).toEqual([
      { term: "tide pool", explanation: "Gezeitentümpel" },
    ]);
  });

  test("a multi-line explanation keeps its line breaks through a save", async () => {
    // Nothing flattens an explanation on the way in or out: it is one column
    // and travels as one string.
    const explanation = "Zeile eins\nZeile zwei";
    const res = await send("POST", TERMS, { term: "Ton", explanation });
    expect(res.status).toBe(201);
    const created = (await res.json()) as GlossaryTerm;
    expect(created.explanation).toBe(explanation);
    expect((await listTerms()).find((term) => term.id === created.id)?.explanation).toBe(
      explanation,
    );
  });

  test("an unrelated write does not invalidate an open term edit", async () => {
    // A term's guard is its own row version, not `campaigns.version`, which
    // any write — a quick note during a running session — moves.
    const [open] = await listTerms();
    const started = await send("POST", "/api/campaigns/beispiel/sessions", {});
    expect(started.status).toBe(201);
    const { id: session } = (await started.json()) as { id: string };
    expect(
      (await send("POST", `/api/campaigns/beispiel/sessions/${session}/log`, { text: "Etwas passiert" }))
        .status,
    ).toBe(201);
    expect((await send("POST", "/api/campaigns/beispiel/ideas", { text: "Idee #idee" })).status).toBe(201);
    expect(await version()).toBeGreaterThan(1);

    const saved = await send("PATCH", `${TERMS}/${open!.id}`, {
      rev: open!.rev,
      explanation: "Gezeitentümpel",
    });
    expect(saved.status).toBe(200);
    // Its own writes DO move it: the same guard again is a 409 with the term.
    const stale = await send("PATCH", `${TERMS}/${open!.id}`, {
      rev: open!.rev,
      explanation: "Überschrieben",
    });
    expect(stale.status).toBe(409);
    const conflict = (await stale.json()) as { code: string; glossaryTerm: GlossaryTerm };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.glossaryTerm.explanation).toBe("Gezeitentümpel");
  });
});
