// The chapter resource (decisions/resources): `GET …/chapters`, `GET` and `PATCH
// …/chapters/:id`, every field of a chapter flat — `body` among them —
// beside its `rev`, and every write checked against the chapter's schema. The
// address the chapter once had under `…/entries/` names nothing.
//
// The active chapter is the chapter's `status`: at most one chapter per
// campaign is active, and a write that makes one active puts the one that
// held it back to `planned` in the same transaction — its `rev` moving with
// it. The create side of the resource is in create-api.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import type { Chapter } from "@grimoire/shared";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const CHAPTERS = "/api/campaigns/beispiel/chapters";
const SALZHAFEN = `${CHAPTERS}/01-salzhafen`;

async function getChapter(url = SALZHAFEN): Promise<Chapter> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Chapter;
}

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const patchChapter = (body: unknown, url = SALZHAFEN): Promise<Response> =>
  send("PATCH", url, body);

async function patchOk(body: unknown, url = SALZHAFEN): Promise<Chapter> {
  const res = await patchChapter(body, url);
  expect(res.status).toBe(200);
  return (await res.json()) as Chapter;
}

async function createChapter(body: Record<string, unknown>): Promise<Chapter> {
  const res = await send("POST", CHAPTERS, body);
  expect(res.status).toBe(201);
  return (await res.json()) as Chapter;
}

/** Every chapter of the campaign by id, as the list answers it. */
async function chaptersById(): Promise<Record<string, Chapter>> {
  const res = await app.request(CHAPTERS);
  expect(res.status).toBe(200);
  const list = (await res.json()) as Chapter[];
  return Object.fromEntries(list.map((chapter) => [chapter.id, chapter]));
}

async function campaignVersion(): Promise<number> {
  const res = await app.request("/api/campaigns/beispiel/version");
  return ((await res.json()) as { version: number }).version;
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading a chapter", () => {
  test("GET answers every field flat — no kind, no path, no properties", async () => {
    const chapter = await getChapter();
    expect(chapter).toEqual({
      id: "01-salzhafen",
      title: "Kapitel 1: Der Leuchtturm von Salzhafen",
      status: "active",
      body: "Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.\n",
      rev: chapter.rev,
    });
  });

  test("the list answers every chapter in its own shape, in the campaign's order", async () => {
    await createChapter({ title: "02 Tiefe" });
    const res = await app.request(CHAPTERS);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Chapter[];
    expect(list.map((chapter) => chapter.id)).toEqual(["01-salzhafen", "02-tiefe"]);
    expect(list[0]).toEqual(await getChapter());
  });

  test("404 for an unknown chapter or campaign", async () => {
    expect((await app.request(`${CHAPTERS}/gibt-es-nicht`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nirgends/chapters/01-salzhafen")).status).toBe(404);
    expect((await app.request("/api/campaigns/nirgends/chapters")).status).toBe(404);
  });

  test("the entry address of a chapter names nothing — GET and PATCH are 404", async () => {
    const before = await getChapter();
    const url = entriesUrl("beispiel", "01-salzhafen");
    expect((await app.request(url)).status).toBe(404);
    expect((await send("PATCH", url, { rev: before.rev, body: "Überschrieben.\n" })).status).toBe(
      404,
    );
    expect(await getChapter()).toEqual(before);
  });
});

describe("writing a chapter", () => {
  test("only the named fields change, and the body is a field like the others", async () => {
    const before = await getChapter();
    const versionBefore = await campaignVersion();
    const after = await patchOk({
      rev: before.rev,
      title: "Kapitel 1: Salzhafen",
      body: "\n## Flow\n\nEin Satz.",
    });
    expect(after).toEqual({
      ...before,
      title: "Kapitel 1: Salzhafen",
      // A body without a trailing newline gets exactly one.
      body: "\n## Flow\n\nEin Satz.\n",
      rev: before.rev + 1,
    });
    // ONE write: the rev and the campaign version step once each.
    expect(await getChapter()).toEqual(after);
    expect(await campaignVersion()).toBe(versionBefore + 1);
  });

  test("unknown callouts and headings survive a write verbatim", async () => {
    const before = await getChapter();
    const body = "\n## Völlig Eigenes\n\n> [!wetter] Nebel über der Bucht\n\n### Unter-Titel\n";
    const after = await patchOk({ rev: before.rev, body });
    expect(after.body).toBe(body);
    const back = await patchOk({ rev: after.rev, body: before.body });
    expect(back.body).toBe(before.body);
  });

  test("`null` clears the status — a chapter may have none", async () => {
    const before = await getChapter();
    const after = await patchOk({ rev: before.rev, status: null });
    expect(Object.hasOwn(after, "status")).toBe(false);
    expect(await getChapter()).toEqual(after);
  });

  test("a field a chapter does not have, or a value of the wrong shape, is a 400 naming it", async () => {
    const before = await getChapter();
    for (const [key, value] of [
      ["goal", "Ankommen"],
      ["properties", { title: "x" }],
      ["title", 7],
      ["body", ["x"]],
    ] as const) {
      const res = await patchChapter({ rev: before.rev, [key]: value });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect(await getChapter()).toEqual(before);
  });

  test("a status outside the three is status_not_allowed, and nothing is written", async () => {
    const before = await getChapter();
    for (const status of ["laeuft", 3]) {
      const res = await patchChapter({ rev: before.rev, status });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string; kind: string; allowed: string[] };
      expect(body.code).toBe("status_not_allowed");
      expect(body.kind).toBe("chapter");
      expect(body.allowed).toEqual(["planned", "active", "done"]);
    }
    expect(await getChapter()).toEqual(before);
  });

  test("the column itself refuses an unknown value — not just the API", async () => {
    const db = await getDb();
    expect(() =>
      db.run(
        sql`update chapters set status = 'laeuft' where campaign_id = 'beispiel' and id = '01-salzhafen'`,
      ),
    ).toThrow();
  });

  test("a request that names no field is nothing_to_write", async () => {
    const before = await getChapter();
    const res = await patchChapter({ rev: before.rev });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("nothing_to_write");
    expect(await getChapter()).toEqual(before);
  });

  test("the id may be echoed, never changed", async () => {
    const before = await getChapter();
    const res = await patchChapter({ rev: before.rev, id: "neu" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("id is the primary key");
    expect(await getChapter()).toEqual(before);
    const same = await patchOk({ rev: before.rev, id: "01-salzhafen", status: "done" });
    expect(same.status).toBe("done");
  });

  test("a stale rev is 409 with the current chapter, and nothing is written", async () => {
    const before = await getChapter();
    const res = await patchChapter({ rev: before.rev - 1, status: "done" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; rev: number; chapter: Chapter };
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(before.rev);
    expect(body.chapter).toEqual(before);
    expect(await getChapter()).toEqual(before);
  });

  test("force keeps a field somebody else changed while replacing the text", async () => {
    const read = await getChapter();
    await patchOk({ rev: read.rev, status: "done" });
    const forced = await patchOk({
      rev: read.rev,
      body: "\n## Flow\n\nTrotzdem gespeichert.\n",
      force: true,
    });
    expect(forced.body).toBe("\n## Flow\n\nTrotzdem gespeichert.\n");
    expect(forced.status).toBe("done");
    expect(await getChapter()).toEqual(forced);
  });

  test("404 for an unknown chapter or campaign", async () => {
    expect((await patchChapter({ rev: 1, title: "x" }, `${CHAPTERS}/gibt-es-nicht`)).status).toBe(
      404,
    );
    expect(
      (await patchChapter({ rev: 1, title: "x" }, "/api/campaigns/nirgends/chapters/x")).status,
    ).toBe(404);
  });
});

// Which chapter is active is a field of the chapter, and the one rule about
// it spans rows: at most one chapter per campaign is active.
describe("the one active chapter", () => {
  test("activating B while A is active puts A back to planned, with a new rev", async () => {
    const b = await createChapter({ title: "02 Tiefe" });
    const a = await getChapter();
    expect(a.status).toBe("active");

    const activated = await patchOk({ rev: b.rev, status: "active" }, `${CHAPTERS}/02-tiefe`);
    expect(activated.status).toBe("active");

    const after = await chaptersById();
    expect(after["01-salzhafen"]?.status).toBe("planned");
    // The chapter that lost `active` was written, so its guard moved: an
    // editor open on it sees that it changed.
    expect(after["01-salzhafen"]?.rev).toBe(a.rev + 1);
    expect(Object.values(after).filter((chapter) => chapter.status === "active")).toHaveLength(1);
  });

  test("creating a chapter as active does the same", async () => {
    const a = await getChapter();
    const created = await createChapter({ title: "02 Tiefe", status: "active" });
    expect(created.status).toBe("active");

    const after = await chaptersById();
    expect(after["01-salzhafen"]?.status).toBe("planned");
    expect(after["01-salzhafen"]?.rev).toBe(a.rev + 1);
    expect(Object.values(after).filter((chapter) => chapter.status === "active")).toHaveLength(1);
  });

  test("a stale activation writes nothing — the active chapter stays", async () => {
    const b = await createChapter({ title: "02 Tiefe" });
    const a = await getChapter();
    const res = await patchChapter({ rev: b.rev - 1, status: "active" }, `${CHAPTERS}/02-tiefe`);
    expect(res.status).toBe(409);
    expect(await getChapter()).toEqual(a);
  });

  test("setting a chapter to done or planned leaves the active one alone", async () => {
    const b = await createChapter({ title: "02 Tiefe" });
    const a = await getChapter();
    const done = await patchOk({ rev: b.rev, status: "done" }, `${CHAPTERS}/02-tiefe`);
    await patchOk({ rev: done.rev, status: "planned" }, `${CHAPTERS}/02-tiefe`);
    expect(await getChapter()).toEqual(a);
  });

  test("activating the active chapter again moves nobody else", async () => {
    const b = await createChapter({ title: "02 Tiefe" });
    const a = await getChapter();
    const again = await patchOk({ rev: a.rev, status: "active" });
    expect(again.status).toBe("active");
    expect((await chaptersById())["02-tiefe"]).toEqual(b);
  });

  test("the action endpoint is gone", async () => {
    const res = await send("POST", `${SALZHAFEN}/active`, {});
    expect(res.status).toBe(404);
  });
});
