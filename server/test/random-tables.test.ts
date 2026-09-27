// The random-table resources (decisions/resources): `/api/random-table-sources`
// and `/api/random-tables`, reference data of the instance that the DM
// imports from a 5etools file (decisions/reference-data).
//
// Watched hardest:
//
//   * an import writes every source of the file that has tables, and a second
//     import of the same source replaces its tables;
//   * dice ranges are read from the first column, inline tags as plain text,
//     and a table without dice ranges keeps every column;
//   * a file that is no 5etools file, or has no table, writes nothing;
//   * removing a source takes its tables and their search rows along, against
//     its `rev`;
//   * every campaign's search finds a table, and names it as a random table.

import { afterEach, describe, expect, test } from "bun:test";
import type { SearchResponse } from "@grimoire/shared";
import type { RandomTable, RandomTableSource } from "@grimoire/shared/random-table";
import { cellText, dieRange, plainText } from "../src/fivetools-tables";
import { app } from "../src/server";
import { dropStore, emptyStore, seedStore } from "./support/store";

afterEach(() => {
  dropStore();
});

/** A 5etools file with one source of two tables and one source without any. */
function harbourFile(weather: unknown[][] = WEATHER) {
  return {
    _meta: {
      sources: [
        {
          json: "HarbourTables",
          full: "Tables of Salt Harbour",
          url: "https://example.org/harbour",
          authors: ["Test Author"],
        },
        { json: "EmptySource", full: "No tables here" },
      ],
    },
    table: [
      {
        name: "Harbour Weather",
        source: "HarbourTables",
        caption: "Weather",
        colLabels: ["{@dice d6}", "Weather"],
        intro: ["Roll at dawn."],
        rows: weather,
      },
      {
        name: "Dockside Names",
        source: "HarbourTables",
        colLabels: ["Name", "Trade"],
        rows: [
          ["Mara Brine", "net mender"],
          ["Old Tobin", "ferryman"],
        ],
      },
    ],
  };
}

const WEATHER = [
  ["1-3", "Fog over the {@b piers}."],
  ["4-5", "North wind."],
  ["6", "A storm; the {@creature harbour master|MM} closes the gate."],
];

async function send(method: string, url: string, body?: unknown) {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(url: string, status = 200): Promise<T> {
  const answer = await app.request(url);
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

describe("importing a 5etools file", () => {
  test("a fresh instance has no random tables", async () => {
    await emptyStore();
    expect(await json<RandomTableSource[]>("/api/random-table-sources")).toEqual([]);
    expect(await json<RandomTable[]>("/api/random-tables")).toEqual([]);
  });

  test("writes every source with tables, each table with its dice ranges and plain text", async () => {
    await emptyStore();
    const answer = await send("POST", "/api/random-table-sources", harbourFile());
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual([
      {
        id: "harbourtables",
        title: "Tables of Salt Harbour",
        authors: ["Test Author"],
        url: "https://example.org/harbour",
        rev: 1,
      },
    ]);
    expect(await json<RandomTable>("/api/random-tables/harbourtables-harbour-weather")).toEqual({
      id: "harbourtables-harbour-weather",
      source: "harbourtables",
      name: "Harbour Weather",
      caption: "Weather",
      intro: "Roll at dawn.",
      die: 6,
      columns: ["Weather"],
      rows: [
        { min: 1, max: 3, cells: ["Fog over the piers."] },
        { min: 4, max: 5, cells: ["North wind."] },
        { min: 6, max: 6, cells: ["A storm; the harbour master closes the gate."] },
      ],
      rev: 1,
    });
    const names = await json<RandomTable>("/api/random-tables/harbourtables-dockside-names");
    expect(names.die).toBeNull();
    expect(names.columns).toEqual(["Name", "Trade"]);
    expect(names.rows[0]).toEqual({ min: null, max: null, cells: ["Mara Brine", "net mender"] });
    const listed = await json<RandomTable[]>("/api/random-tables?source=harbourtables");
    expect(listed.map((table) => table.id)).toEqual([
      "harbourtables-harbour-weather",
      "harbourtables-dockside-names",
    ]);
  });

  test("importing a source again replaces its tables and moves its rev", async () => {
    await emptyStore();
    await send("POST", "/api/random-table-sources", harbourFile());
    const file = harbourFile([["1-6", "Clear skies."]]);
    file.table.pop();
    const answer = await send("POST", "/api/random-table-sources", file);
    expect(answer.status).toBe(201);
    expect(((await answer.json()) as RandomTableSource[])[0]!.rev).toBe(2);
    const tables = await json<RandomTable[]>("/api/random-tables");
    expect(tables.map((table) => table.id)).toEqual(["harbourtables-harbour-weather"]);
    expect(tables[0]!.rows).toEqual([{ min: 1, max: 6, cells: ["Clear skies."] }]);
    expect(tables[0]!.rev).toBe(2);
    await json("/api/random-tables/harbourtables-dockside-names", 404);
  });

  test("a file that is no 5etools file, or holds no table, is a 400 and writes nothing", async () => {
    await emptyStore();
    const notFivetools = await send("POST", "/api/random-table-sources", { tables: [] });
    expect(notFivetools.status).toBe(400);
    expect(((await notFivetools.json()) as { code: string }).code).toBe("import_not_fivetools");
    const file = harbourFile();
    file.table = [];
    const noTables = await send("POST", "/api/random-table-sources", file);
    expect(noTables.status).toBe(400);
    expect(((await noTables.json()) as { code: string }).code).toBe("import_no_tables");
    expect(await json<RandomTableSource[]>("/api/random-table-sources")).toEqual([]);
  });
});

describe("removing a source", () => {
  test("takes its tables along against its rev; a stale rev is 409 with the source", async () => {
    await seedStore();
    await send("POST", "/api/random-table-sources", harbourFile());
    const stale = await send("DELETE", "/api/random-table-sources/harbourtables", { rev: 7 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "rev_conflict",
      rev: 1,
      randomTableSource: { id: "harbourtables" },
    });

    const removed = await send("DELETE", "/api/random-table-sources/harbourtables", { rev: 1 });
    expect(removed.status).toBe(204);
    expect(await json<RandomTable[]>("/api/random-tables")).toEqual([]);
    await json("/api/random-table-sources/harbourtables", 404);
    const search = await json<SearchResponse>("/api/campaigns/example/search?q=harbour%20weather");
    expect(search.results.filter((hit) => hit.kind === "random-table")).toEqual([]);
  });
});

describe("searching random tables", () => {
  test("every campaign's search finds a table by its name", async () => {
    await seedStore();
    await send("POST", "/api/random-table-sources", harbourFile());
    const search = await json<SearchResponse>("/api/campaigns/example/search?q=dockside");
    expect(search.results[0]).toMatchObject({
      kind: "random-table",
      id: "harbourtables-dockside-names",
      title: "Dockside Names",
    });
  });
});

describe("reading 5etools cells", () => {
  test("dice ranges, including a d100's 00", () => {
    expect(dieRange("7")).toEqual({ min: 7, max: 7 });
    expect(dieRange("01-05")).toEqual({ min: 1, max: 5 });
    expect(dieRange("96–00")).toEqual({ min: 96, max: 100 });
    expect(dieRange(12)).toEqual({ min: 12, max: 12 });
    expect(dieRange({ type: "cell", roll: { min: 2, max: 4 } })).toEqual({ min: 2, max: 4 });
    expect(dieRange({ type: "cell", roll: { exact: 9 } })).toEqual({ min: 9, max: 9 });
    expect(dieRange("{@book Angry Mob|WCE|2|Angry Mob}")).toBeNull();
  });

  test("inline tags read as the text they display", () => {
    expect(plainText("{@creature goblin|MM} and {@item longsword|PHB|a fine sword}")).toBe(
      "goblin and a fine sword",
    );
    expect(plainText("{@dc 15} or {@hit 4}, {@dice 2d6}")).toBe("DC 15 or +4, 2d6");
    expect(plainText("{@b {@creature bandit|MM|bandits}}")).toBe("bandits");
    expect(plainText("{@book Angry Mob|WCE|2|Angry Mob}")).toBe("Angry Mob");
  });

  test("an entry object reads as the text it holds, never an error", () => {
    expect(
      cellText({
        type: "entries",
        name: "Trap",
        entries: ["A {@b pit}.", { type: "list", items: ["one"] }],
      }),
    ).toBe("Trap A pit. one");
    expect(cellText(null)).toBe("");
    expect(cellText({ unknown: true })).toBe("");
  });
});
