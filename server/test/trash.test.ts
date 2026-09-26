// The trash (decisions/trash): chapters, scenes, npcs, locations and ideas go
// there with their DELETE `{ rev }`, come back with a PATCH of
// `deletedMs: null`, and are listed with `?deleted=true`. Everything else
// treats a row in the trash as absent — its GET, its lists, the tree, the
// search, a reference — while its id stays taken until the purge removes it.
//
// Watched hardest:
//
//   * what keeps a row out of the trash, or in it, is a 409 naming the rows
//     in the way, and nothing is written;
//   * a chapter takes exactly its live scenes and threads along and brings
//     exactly those back, the scenes in their order;
//   * the purge removes only what is past its retention, in an order the
//     foreign keys accept.
//
// One fresh database per case, seeded from the committed fixtures
// (test/support/store.ts). The clock is set per case wherever a moment
// matters, because a trash moment is second-precise.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { Chapter } from "@grimoire/shared/chapter";
import type { Idea } from "@grimoire/shared/idea";
import type { Location } from "@grimoire/shared/location";
import type { Npc } from "@grimoire/shared/npc";
import type { Scene } from "@grimoire/shared/scene";
import type { Thread } from "@grimoire/shared/thread";
import type { CampaignTree, SearchResult } from "@grimoire/shared";
import { app } from "../src/server";
import { writeGenerated } from "../src/store/generated";
import { purgeTrash, TRASH_RETENTION_DAYS } from "../src/store/trash";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "example";
const API = `/api/campaigns/${CAMPAIGN}`;
const CHAPTER = "01-salt-harbour";
/** The fixture scene no log entry names — free to go to the trash. */
const FREE_SCENE = "smuggler-captured";
/** The fixture scene the fixture session's log entries name. */
const NOTED_SCENE = "lighthouse-arrival";
const DAY_MS = 24 * 60 * 60 * 1000;

interface ErrorBody {
  code?: string;
  kind?: string;
  id?: string;
  blockers?: Array<{ kind: string; id: string; name: string; session?: string }>;
  [key: string]: unknown;
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const answer = await res;
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

const get = <T>(path: string, status = 200) => json<T>(app.request(`${API}${path}`), status);
const trash = <T>(path: string, rev: number, status = 200) =>
  json<T>(send("DELETE", `${API}${path}`, { rev }), status);
const restore = <T>(path: string, rev: number, status = 200) =>
  json<T>(send("PATCH", `${API}${path}`, { rev, deletedMs: null }), status);
const post = <T>(path: string, body: unknown, status = 201) =>
  json<T>(send("POST", `${API}${path}`, body), status);

async function version(): Promise<number> {
  return (await get<{ version: number }>("/version")).version;
}

async function search(q: string): Promise<SearchResult[]> {
  return (await get<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`)).results;
}

/** Set the server's clock to a fixed moment. */
function at(ms: number): void {
  setSystemTime(new Date(ms));
}

/** A fixed moment the cases start from. */
const T0 = new Date(2026, 3, 10, 18, 0, 0).getTime();

/**
 * A second chapter nothing else names: two scenes (reordered, so the order
 * is the DM's and not the order of creation) and one thread.
 */
async function secondChapter(): Promise<{ chapter: Chapter; scenes: string[]; thread: Thread }> {
  const chapter = await post<Chapter>("/chapters", { title: "Chapter Two", id: "two" });
  const first = await post<Scene>("/scenes", { title: "First", chapter: "two", id: "first" });
  const second = await post<Scene>("/scenes", { title: "Second", chapter: "two", id: "second" });
  const tree = await get<CampaignTree>("/tree");
  const node = tree.chapters.find((c) => c.id === "two");
  await json(
    send("PUT", `${API}/chapters/two/scene-order`, {
      scenes: [second.id, first.id],
      rev: node?.sceneOrderRev,
    }),
  );
  const thread = await post<Thread>("/threads", { chapter: "two", text: "Who was it?" });
  return { chapter, scenes: [second.id, first.id], thread };
}

beforeEach(async () => {
  at(T0);
  await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("a scene in the trash", () => {
  test("DELETE answers the scene with its moment and a moved rev, and the version moves", async () => {
    const before = await version();
    const scene = await trash<Scene>(`/scenes/${FREE_SCENE}`, 1);
    expect(scene.id).toBe(FREE_SCENE);
    expect(scene.deletedMs).toBe(T0);
    expect(scene.rev).toBe(2);
    expect(await version()).toBeGreaterThan(before);
  });

  test("it is gone for its GET, its PATCH, the list, the tree and the chapter's order", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    await get(`/scenes/${FREE_SCENE}`, 404);
    await json(send("PATCH", `${API}/scenes/${FREE_SCENE}`, { rev: 2, title: "x" }), 404);
    await trash(`/scenes/${FREE_SCENE}`, 2, 404);
    expect((await get<Scene[]>("/scenes")).map((s) => s.id)).toEqual([NOTED_SCENE]);
    const tree = await get<CampaignTree>("/tree");
    const node = tree.chapters.find((c) => c.id === CHAPTER);
    expect(node?.scenes.map((s) => s.id)).toEqual([NOTED_SCENE]);
    // The order of the chapter names its live scenes only.
    await json(
      send("PUT", `${API}/chapters/${CHAPTER}/scene-order`, {
        scenes: [NOTED_SCENE],
        rev: node?.sceneOrderRev,
      }),
    );
  });

  test("?deleted=true lists the scenes in the trash; any other value is a 400", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const listed = await get<Scene[]>("/scenes?deleted=true");
    expect(listed.map((s) => [s.id, s.deletedMs])).toEqual([[FREE_SCENE, T0]]);
    await get("/scenes?deleted=yes", 400);
  });

  test("a stale rev is 409 with the current scene, and nothing moves", async () => {
    const body = await trash<ErrorBody>(`/scenes/${FREE_SCENE}`, 7, 409);
    expect(body.code).toBe("rev_conflict");
    expect((body.scene as Scene).rev).toBe(1);
    expect((await get<Scene>(`/scenes/${FREE_SCENE}`)).rev).toBe(1);
  });

  test("a scene a log entry names stays, and the 409 names those entries", async () => {
    const body = await trash<ErrorBody>(`/scenes/${NOTED_SCENE}`, 1, 409);
    expect(body.code).toBe("trash_blocked");
    expect(body.kind).toBe("scene");
    expect(body.id).toBe(NOTED_SCENE);
    expect(body.blockers?.map((b) => [b.kind, b.id, b.session])).toEqual([
      ["log-entry", "tracks-found", "2026-01-15"],
      ["log-entry", "old-metta", "2026-01-15"],
    ]);
    expect((await get<Scene>(`/scenes/${NOTED_SCENE}`)).rev).toBe(1);
  });

  test("it leaves the search and comes back with its restore", async () => {
    const hit = (results: SearchResult[]) =>
      results.some((r) => r.kind === "scene" && r.id === FREE_SCENE);
    expect(hit(await search("Smugglers"))).toBe(true);
    await trash(`/scenes/${FREE_SCENE}`, 1);
    expect(hit(await search("Smugglers"))).toBe(false);
    await restore(`/scenes/${FREE_SCENE}`, 2);
    expect(hit(await search("Smugglers"))).toBe(true);
  });

  test("its id stays taken: creating it again is the slug collision", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const body = await post<ErrorBody>(
      "/scenes",
      { title: "New", chapter: CHAPTER, id: FREE_SCENE },
      409,
    );
    expect(body.code).toBe("slug_taken");
    expect(body.suggestion).toBe(`${FREE_SCENE}-2`);
  });

  test("a log entry cannot name it", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const session = await post<{ id: string }>("/sessions", {});
    const body = await post<ErrorBody>(
      `/sessions/${session.id}/log`,
      { text: "A note", sceneId: FREE_SCENE },
      400,
    );
    expect(body.code).toBe("log_scene_unknown");
  });
});

describe("restoring a scene", () => {
  test("it comes back at the end of its chapter's order, with a moved rev", async () => {
    await post<Scene>("/scenes", { title: "Third", chapter: CHAPTER, id: "third" });
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const scene = await restore<Scene>(`/scenes/${FREE_SCENE}`, 2);
    expect(scene.deletedMs).toBeUndefined();
    expect(scene.rev).toBe(3);
    expect((await get<Scene[]>("/scenes")).map((s) => s.id)).toEqual([
      NOTED_SCENE,
      "third",
      FREE_SCENE,
    ]);
    expect((await get<Scene>(`/scenes/${FREE_SCENE}`)).rev).toBe(3);
  });

  test("a stale rev is 409, and deletedMs takes no other value than null", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    expect((await restore<ErrorBody>(`/scenes/${FREE_SCENE}`, 1, 409)).code).toBe("rev_conflict");
    await json(send("PATCH", `${API}/scenes/${FREE_SCENE}`, { rev: 2, deletedMs: T0 }), 400);
    await json(
      send("PATCH", `${API}/scenes/${FREE_SCENE}`, { rev: 2, deletedMs: null, title: "x" }),
      404,
    );
    expect((await get<Scene[]>("/scenes?deleted=true")).map((s) => s.rev)).toEqual([2]);
  });

  test("a scene whose npc is in the trash stays there, and the 409 names the npc", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const fenn = await get<Npc>("/npcs/fenn");
    at(T0 + 1000);
    await trash(`/npcs/fenn`, fenn.rev);
    const body = await restore<ErrorBody>(`/scenes/${FREE_SCENE}`, 2, 409);
    expect(body.code).toBe("restore_blocked");
    expect(body.blockers?.map((b) => [b.kind, b.id])).toEqual([["npc", "fenn"]]);
    await restore(`/npcs/fenn`, fenn.rev + 1);
    await restore(`/scenes/${FREE_SCENE}`, 2);
  });

  test("a scene whose chapter is in the trash stays there", async () => {
    const { scenes } = await secondChapter();
    const scene = await get<Scene>(`/scenes/${scenes[0]}`);
    await trash(`/scenes/${scene.id}`, scene.rev);
    at(T0 + 1000);
    const chapter = await get<Chapter>("/chapters/two");
    await trash(`/chapters/two`, chapter.rev);
    const body = await restore<ErrorBody>(`/scenes/${scene.id}`, scene.rev + 1, 409);
    expect(body.code).toBe("chapter_in_trash");
    expect(body.blockers?.map((b) => [b.kind, b.id])).toEqual([["chapter", "two"]]);
  });
});

describe("npcs and locations in the trash", () => {
  test("an npc a live scene names stays; once the scene is gone it can go", async () => {
    const body = await trash<ErrorBody>("/npcs/fenn", 1, 409);
    expect(body.code).toBe("trash_blocked");
    expect(body.blockers?.map((b) => [b.kind, b.id, b.name])).toEqual([
      ["scene", FREE_SCENE, "Caught by the Smugglers"],
    ]);
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const npc = await trash<Npc>("/npcs/fenn", 1);
    expect(npc.deletedMs).toBe(T0);
    await get("/npcs/fenn", 404);
    expect((await get<Npc[]>("/npcs")).map((n) => n.id)).toEqual(["jorna"]);
    expect((await get<Npc[]>("/npcs?deleted=true")).map((n) => n.id)).toEqual(["fenn"]);
    expect((await get<CampaignTree>("/tree")).npcs.map((n) => n.id)).toEqual(["jorna"]);
    expect((await search("Fenn")).some((r) => r.kind === "npc" && r.id === "fenn")).toBe(false);
  });

  test("a live scene cannot name an npc in the trash", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    await trash("/npcs/fenn", 1);
    const body = await json<ErrorBody>(
      send("PATCH", `${API}/scenes/${NOTED_SCENE}`, { rev: 1, npcs: ["jorna", "fenn"] }),
      400,
    );
    expect(body.code).toBe("npc_unknown");
  });

  test("an npc in the trash is never filled: its id is taken, empty or not", async () => {
    const empty = await post<Npc>("/npcs", { name: "empty" });
    await trash(`/npcs/${empty.id}`, empty.rev);
    const body = await post<ErrorBody>("/npcs", { name: "Empty", id: empty.id }, 409);
    expect(body.code).toBe("slug_taken");
    await expect(
      writeGenerated(CAMPAIGN, {
        npcs: [{ id: empty.id, name: "Empty", status: "alive", body: "" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("an npc whose chapter is in the trash stays there", async () => {
    await secondChapter();
    const npc = await post<Npc>("/npcs", { name: "Another" });
    const moved = await json<Npc>(
      send("PATCH", `${API}/npcs/${npc.id}`, { rev: npc.rev, chapter: "two" }),
    );
    await trash(`/npcs/${npc.id}`, moved.rev);
    at(T0 + 1000);
    const chapter = await get<Chapter>("/chapters/two");
    await trash("/chapters/two", chapter.rev);
    const body = await restore<ErrorBody>(`/npcs/${npc.id}`, moved.rev + 1, 409);
    expect(body.code).toBe("restore_blocked");
    expect(body.blockers?.map((b) => [b.kind, b.id])).toEqual([["chapter", "two"]]);
  });

  test("a location a live scene plays at stays; once the scene is gone it can go and come back", async () => {
    const body = await trash<ErrorBody>("/locations/cove", 1, 409);
    expect(body.code).toBe("trash_blocked");
    expect(body.blockers?.map((b) => [b.kind, b.id])).toEqual([["scene", FREE_SCENE]]);
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const location = await trash<Location>("/locations/cove", 1);
    expect(location.deletedMs).toBe(T0);
    await get("/locations/cove", 404);
    expect((await get<Location[]>("/locations?deleted=true")).map((l) => l.id)).toEqual(["cove"]);
    const back = await restore<Location>("/locations/cove", 2);
    expect(back.deletedMs).toBeUndefined();
    expect(back.rev).toBe(3);
  });
});

describe("a chapter in the trash", () => {
  test("a chapter live npcs, locations or noted scenes hang on stays, and the 409 names them", async () => {
    const body = await trash<ErrorBody>(`/chapters/${CHAPTER}`, 1, 409);
    expect(body.code).toBe("trash_blocked");
    expect(body.blockers?.map((b) => [b.kind, b.id])).toEqual([
      ["npc", "fenn"],
      ["npc", "jorna"],
      ["location", "cove"],
      ["location", "lighthouse"],
      ["log-entry", "tracks-found"],
      ["log-entry", "old-metta"],
    ]);
    expect((await get<Chapter>(`/chapters/${CHAPTER}`)).rev).toBe(1);
  });

  test("it takes its live scenes and threads along, and brings exactly those back in their order", async () => {
    const { scenes, thread } = await secondChapter();
    // A scene that goes to the trash on its own, earlier, stays there.
    const alone = await post<Scene>("/scenes", { title: "Alone", chapter: "two", id: "alone" });
    await trash(`/scenes/${alone.id}`, alone.rev);
    at(T0 + 1000);
    const chapter = await get<Chapter>("/chapters/two");
    const gone = await trash<Chapter>("/chapters/two", chapter.rev);
    expect(gone.deletedMs).toBe(T0 + 1000);

    await get("/chapters/two", 404);
    expect((await get<Chapter[]>("/chapters")).map((c) => c.id)).toEqual([CHAPTER]);
    expect((await get<Chapter[]>("/chapters?deleted=true")).map((c) => c.id)).toEqual(["two"]);
    const trashed = await get<Scene[]>("/scenes?deleted=true");
    expect(trashed.map((s) => [s.id, s.deletedMs])).toEqual([
      [scenes[0], T0 + 1000],
      [scenes[1], T0 + 1000],
      [alone.id, T0],
    ]);
    expect(await get<Thread[]>("/threads?chapter=two")).toEqual([]);
    await get(`/threads/${thread.id}`, 404);
    expect((await get<CampaignTree>("/tree")).chapters.map((c) => c.id)).toEqual([CHAPTER]);
    expect((await search("Chapter Two")).some((r) => r.id === "two")).toBe(false);
    // A chapter in the trash is none a new row can name.
    expect((await post<ErrorBody>("/scenes", { title: "X", chapter: "two" }, 400)).code).toBe(
      "chapter_unknown",
    );
    expect(
      (await post<ErrorBody>("/threads", { chapter: "two", text: "Y" }, 400)).code,
    ).toBe("chapter_unknown");

    const back = await restore<Chapter>("/chapters/two", gone.rev);
    expect(back.deletedMs).toBeUndefined();
    expect((await get<Scene[]>("/scenes")).map((s) => s.id)).toEqual([
      NOTED_SCENE,
      FREE_SCENE,
      ...scenes,
    ]);
    expect((await get<Scene[]>("/scenes?deleted=true")).map((s) => s.id)).toEqual([alone.id]);
    const threads = await get<Thread[]>("/threads?chapter=two");
    expect(threads.map((t) => [t.id, t.rev])).toEqual([[thread.id, thread.rev + 2]]);
    expect((await get<Scene>(`/scenes/${scenes[0]}`)).rev).toBe(3);
    expect((await search("Chapter Two")).some((r) => r.id === "two")).toBe(true);
  });

  test("a scene of it naming a location in the trash keeps the whole chapter there", async () => {
    await secondChapter();
    const place = await post<Location>("/locations", { name: "Place" });
    const scene = await get<Scene>("/scenes/first");
    await json(send("PATCH", `${API}/scenes/first`, { rev: scene.rev, location: place.id }));
    const chapter = await get<Chapter>("/chapters/two");
    await trash("/chapters/two", chapter.rev);
    at(T0 + 1000);
    await trash(`/locations/${place.id}`, place.rev);
    const body = await restore<ErrorBody>("/chapters/two", chapter.rev + 1, 409);
    expect(body.code).toBe("restore_blocked");
    expect(body.blockers?.map((b) => [b.kind, b.id])).toEqual([["location", place.id]]);
    expect(await get<Chapter[]>("/chapters?deleted=true")).toHaveLength(1);
  });

  test("an active chapter comes back planned when another one became active meanwhile", async () => {
    await secondChapter();
    const two = await get<Chapter>("/chapters/two");
    const active = await json<Chapter>(
      send("PATCH", `${API}/chapters/two`, { rev: two.rev, status: "active" }),
    );
    await trash("/chapters/two", active.rev);
    const first = await get<Chapter>(`/chapters/${CHAPTER}`);
    expect(first.status).toBe("planned");
    await json(send("PATCH", `${API}/chapters/${CHAPTER}`, { rev: first.rev, status: "active" }));
    const back = await restore<Chapter>("/chapters/two", active.rev + 1);
    expect(back.status).toBe("planned");
    expect((await get<Chapter>(`/chapters/${CHAPTER}`)).status).toBe("active");
  });

  test("an active chapter comes back active when no other one is", async () => {
    await secondChapter();
    const two = await get<Chapter>("/chapters/two");
    const active = await json<Chapter>(
      send("PATCH", `${API}/chapters/two`, { rev: two.rev, status: "active" }),
    );
    await trash("/chapters/two", active.rev);
    expect((await restore<Chapter>("/chapters/two", active.rev + 1)).status).toBe("active");
  });

  test("a new-chapter run cannot take the id of a chapter in the trash", async () => {
    await secondChapter();
    const chapter = await get<Chapter>("/chapters/two");
    await trash("/chapters/two", chapter.rev);
    await expect(
      writeGenerated(CAMPAIGN, {
        chapter: { id: "two", title: "Two", status: "planned", body: "" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("an idea in the trash", () => {
  test("it leaves the list, is listed with ?deleted=true and comes back at its place", async () => {
    const idea = (await get<Idea[]>("/ideas"))[0] as Idea;
    const gone = await trash<Idea>(`/ideas/${idea.id}`, idea.rev);
    expect(gone.deletedMs).toBe(T0);
    expect(await get<Idea[]>("/ideas")).toEqual([]);
    await get(`/ideas/${idea.id}`, 404);
    await json(send("PATCH", `${API}/ideas/${idea.id}`, { rev: gone.rev, done: true }), 404);
    expect((await get<Idea[]>("/ideas?deleted=true")).map((i) => i.id)).toEqual([idea.id]);
    const back = await restore<Idea>(`/ideas/${idea.id}`, gone.rev);
    expect(back).toEqual({ ...idea, rev: idea.rev + 2 });
    expect(await get<Idea[]>("/ideas")).toEqual([back]);
  });
});

describe("the purge", () => {
  test("removes only what has been in the trash longer than the retention", async () => {
    await trash(`/scenes/${FREE_SCENE}`, 1);
    const before = await version();
    expect(await purgeTrash(new Date(T0 + (TRASH_RETENTION_DAYS - 1) * DAY_MS))).toBe(0);
    expect(await version()).toBe(before);
    expect(await get<Scene[]>("/scenes?deleted=true")).toHaveLength(1);

    expect(await purgeTrash(new Date(T0 + (TRASH_RETENTION_DAYS + 1) * DAY_MS))).toBe(1);
    expect(await version()).toBeGreaterThan(before);
    expect(await get<Scene[]>("/scenes?deleted=true")).toEqual([]);
    // The id is free again.
    await post<Scene>("/scenes", { title: "New", chapter: CHAPTER, id: FREE_SCENE });
  });

  test("removes rows that name each other in an order the foreign keys accept", async () => {
    const { thread } = await secondChapter();
    const place = await post<Location>("/locations", { name: "Place" });
    const first = await get<Scene>("/scenes/first");
    await json(
      send("PATCH", `${API}/scenes/first`, { rev: first.rev, location: place.id, npcs: ["fenn"] }),
    );
    const chapter = await get<Chapter>("/chapters/two");
    await trash("/chapters/two", chapter.rev);
    at(T0 + 1000);
    await trash(`/locations/${place.id}`, place.rev);
    const idea = (await get<Idea[]>("/ideas"))[0] as Idea;
    await trash(`/ideas/${idea.id}`, idea.rev);

    expect(await purgeTrash(new Date(T0 + 1000 + (TRASH_RETENTION_DAYS + 1) * DAY_MS))).toBe(5);
    for (const kind of ["chapters", "scenes", "locations", "ideas"]) {
      expect(await get<unknown[]>(`/${kind}?deleted=true`)).toEqual([]);
    }
    await get(`/threads/${thread.id}`, 404);
    // What the removed scene named is untouched.
    expect((await get<Npc>("/npcs/fenn")).rev).toBe(1);
    await post<Chapter>("/chapters", { title: "Two", id: "two" });
  });
});
