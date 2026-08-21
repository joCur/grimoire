// Write-API tests (issue #5). They run against a TEMP COPY of the example
// campaign: examples/ is the committed format reference and must never be
// mutated, so beforeAll copies examples/beispiel into a mkdtemp dir and
// points the app there via setCampaignRoot() (restored in afterAll). The
// clock is overridden per test via setNow() for deterministic dates.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { getCampaignRoot, setCampaignRoot } from "../src/config";
import { setNow } from "../src/clock";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let originalRoot = "";

const absOf = (rel: string) => path.join(tmpRoot, "beispiel", rel);

async function getFile(rel: string): Promise<FileResponse> {
  const res = await app.request(`/api/beispiel/file?path=${encodeURIComponent(rel)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileResponse;
}

async function patchReq(body: unknown): Promise<Response> {
  return app.request("/api/beispiel/frontmatter", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

beforeAll(async () => {
  originalRoot = getCampaignRoot();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-write-"));
  await cp(path.join(EXAMPLES, "beispiel"), path.join(tmpRoot, "beispiel"), { recursive: true });
  setCampaignRoot(tmpRoot);
});

afterAll(async () => {
  setCampaignRoot(originalRoot);
  setNow(null);
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // 2026-08-19 21:05 local time unless a test overrides it.
  setNow(() => new Date(2026, 7, 19, 21, 5));
});

/** Top-level YAML keys of the frontmatter block, in file order. */
function topLevelKeys(raw: string): string[] {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!m) return [];
  return [...m[1]!.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((k) => k[1]!);
}

describe("PATCH /api/:campaign/frontmatter", () => {
  const SCENE = "01-salzhafen/hafen/ankunft-leuchtturm.md";

  test("happy path: only named keys change, key order stable, body byte-identical", async () => {
    const before = await getFile(SCENE);
    const bodyBefore = before.raw.slice(before.raw.indexOf("\n---\n") + "\n---\n".length);

    const res = await patchReq({ path: SCENE, mtimeMs: before.mtimeMs, patch: { status: "played" } });
    expect(res.status).toBe(200);
    const after = (await res.json()) as FileResponse;
    expect(after.frontmatter.status).toBe("played");

    const raw = await readFile(absOf(SCENE), "utf8");
    // key order: exactly the original file order, nothing added or removed
    expect(topLevelKeys(raw)).toEqual([
      "id",
      "title",
      "type",
      "chapter",
      "location",
      "npcs",
      "handouts",
      "tags",
      "status",
    ]);
    expect(raw).toContain("\nstatus: played\n");
    expect(raw).toContain("id: lighthouse-arrival\n");
    expect(raw).toContain("npcs: [jorna]\n");
    // body after the closing delimiter is byte-identical
    const bodyAfter = raw.slice(raw.indexOf("\n---\n") + "\n---\n".length);
    expect(bodyAfter).toBe(bodyBefore);
    expect(after.raw).toBe(raw);
    // fresh mtimeMs matches the file on disk and a subsequent GET sees the write
    const s = await stat(absOf(SCENE));
    expect(after.mtimeMs).toBe(s.mtimeMs);
    const again = await getFile(SCENE);
    expect(again.frontmatter.status).toBe("played");
    expect(again.mtimeMs).toBe(s.mtimeMs);
  });

  test("new keys are appended after the existing ones", async () => {
    const before = await getFile(SCENE);
    const res = await patchReq({
      path: SCENE,
      mtimeMs: before.mtimeMs,
      patch: { review_note: "nochmal lesen" },
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(SCENE), "utf8");
    const keys = topLevelKeys(raw);
    expect(keys[keys.length - 1]).toBe("review_note");
    expect(raw).toContain("review_note: nochmal lesen\n");
  });

  test("null deletes a key, everything else untouched", async () => {
    const before = await getFile(SCENE);
    const res = await patchReq({
      path: SCENE,
      mtimeMs: before.mtimeMs,
      patch: { review_note: null },
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(SCENE), "utf8");
    expect(raw).not.toContain("review_note");
    expect(topLevelKeys(raw)).not.toContain("review_note");
    expect(raw).toContain("id: lighthouse-arrival\n");
    expect(raw).toContain("\nstatus: played\n"); // from the earlier test
  });

  test("a file without `id` on disk does not gain one", async () => {
    const rel = "01-salzhafen/hafen/ohne-id.md";
    await writeFile(absOf(rel), "---\ntitle: Ohne Id\n---\n\nNur Text.\n", "utf8");
    const before = await getFile(rel);
    // the parser injects the filename id into the RESPONSE...
    expect(before.frontmatter.id).toBe("ohne-id");
    const res = await patchReq({ path: rel, mtimeMs: before.mtimeMs, patch: { status: "draft" } });
    expect(res.status).toBe(200);
    // ...but the patched FILE must not materialize it
    const raw = await readFile(absOf(rel), "utf8");
    expect(topLevelKeys(raw)).toEqual(["title", "status"]);
    expect(raw).not.toContain("id:");
    expect(raw.endsWith("\n---\n\nNur Text.\n")).toBe(true);
  });

  test("a file without a frontmatter block gets one, body untouched", async () => {
    const rel = "01-salzhafen/nur-text.md";
    const body = "## Nur Text\n\nKein Frontmatter hier.\n";
    await writeFile(absOf(rel), body, "utf8");
    const before = await getFile(rel);
    const res = await patchReq({ path: rel, mtimeMs: before.mtimeMs, patch: { status: "draft" } });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(rel), "utf8");
    expect(raw).toBe(`---\nstatus: draft\n---\n${body}`);
  });

  test("_campaign.md is patchable through the same endpoint (issue #17)", async () => {
    const rel = "_campaign.md";
    const before = await getFile(rel);
    expect(before.kind).toBe("campaign");
    const res = await patchReq({
      path: rel,
      mtimeMs: before.mtimeMs,
      patch: { description: "Neue Kurzbeschreibung." },
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as FileResponse;
    expect(after.frontmatter.description).toBe("Neue Kurzbeschreibung.");
    expect(after.frontmatter.name).toBe("Der Leuchtturm von Salzhafen");
    const raw = await readFile(absOf(rel), "utf8");
    expect(topLevelKeys(raw)).toEqual(["id", "name", "description"]); // order stable
    expect(raw).toContain("description: Neue Kurzbeschreibung.\n");
    // the list endpoint picks the new value up right away
    const list = (await (await app.request("/api/campaigns")).json()) as Array<{
      id: string;
      description?: string;
    }>;
    expect(list.find((c) => c.id === "beispiel")?.description).toBe("Neue Kurzbeschreibung.");
  });

  test("409 on stale mtimeMs carries the current mtimeMs", async () => {
    const s = await stat(absOf(SCENE));
    const res = await patchReq({ path: SCENE, mtimeMs: s.mtimeMs - 1, patch: { status: "ready" } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; mtimeMs: number };
    expect(typeof body.error).toBe("string");
    expect(body.mtimeMs).toBe(s.mtimeMs);
    // and nothing was written
    expect((await stat(absOf(SCENE))).mtimeMs).toBe(s.mtimeMs);
  });

  test("400 on malformed bodies", async () => {
    const s = await stat(absOf(SCENE));
    const bad = [
      {}, // missing everything
      { path: SCENE, mtimeMs: s.mtimeMs }, // missing patch
      { path: SCENE, mtimeMs: "later", patch: {} }, // mtimeMs not a number
      { path: SCENE, mtimeMs: s.mtimeMs, patch: ["status"] }, // patch not an object
      { path: SCENE, mtimeMs: s.mtimeMs, patch: {}, extra: 1 }, // unknown key
      { path: 42, mtimeMs: s.mtimeMs, patch: {} }, // path not a string
    ];
    for (const b of bad) {
      expect((await patchReq(b)).status).toBe(400);
    }
    // non-JSON body
    const res = await app.request("/api/beispiel/frontmatter", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "no json",
    });
    expect(res.status).toBe(400);
  });

  test("path safety and missing files behave like the read API", async () => {
    expect(
      (await patchReq({ path: "../../etc/passwd.md", mtimeMs: 1, patch: {} })).status,
    ).toBe(400);
    expect((await patchReq({ path: "notes.txt", mtimeMs: 1, patch: {} })).status).toBe(400);
    expect(
      (await patchReq({ path: "01-salzhafen/nope.md", mtimeMs: 1, patch: {} })).status,
    ).toBe(404);
  });
});

describe("POST /api/:campaign/session/start", () => {
  test("creates today's session file with the documented shape", async () => {
    const res = await postJson("/api/beispiel/session/start");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("sessions/2026-08-19.md");
    expect(file.kind).toBe("session");
    expect(file.frontmatter.id).toBe("2026-08-19");
    expect(file.frontmatter.started).toBe("2026-08-19T21:05");
    expect(file.frontmatter.scenes_played).toEqual([]);
    const raw = await readFile(absOf("sessions/2026-08-19.md"), "utf8");
    expect(raw).toBe(
      "---\nid: 2026-08-19\nstarted: 2026-08-19T21:05\nscenes_played: []\n---\n\n## Log\n",
    );
    expect(file.mtimeMs).toBe((await stat(absOf("sessions/2026-08-19.md"))).mtimeMs);
  });

  test("second start on the same day is idempotent (nothing reset)", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 30));
    const res = await postJson("/api/beispiel/session/start");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.started).toBe("2026-08-19T21:05"); // NOT 21:30
    const raw = await readFile(absOf("sessions/2026-08-19.md"), "utf8");
    expect(raw).toContain("started: 2026-08-19T21:05\n");
  });
});

describe("POST /api/:campaign/log", () => {
  test("404 without a session today", async () => {
    setNow(() => new Date(2026, 7, 21, 20, 0)); // a day with no session file
    const res = await postJson("/api/beispiel/log", { text: "verloren" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  test("appends `- HH:MM (sceneId) text` under ## Log", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 12));
    const res = await postJson("/api/beispiel/log", {
      text: "Spuren am Strand #thread",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("sessions/2026-08-19.md"), "utf8");
    expect(raw.endsWith("## Log\n\n- 21:12 (lighthouse-arrival) Spuren am Strand #thread\n")).toBe(
      true,
    );
  });

  test("omits the parens without sceneId and appends after existing entries", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 20));
    const res = await postJson("/api/beispiel/log", { text: "Pause" });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("sessions/2026-08-19.md"), "utf8");
    expect(
      raw.endsWith("- 21:12 (lighthouse-arrival) Spuren am Strand #thread\n- 21:20 Pause\n"),
    ).toBe(true);
  });

  test("multi-line text collapses to a single log line", async () => {
    setNow(() => new Date(2026, 7, 19, 21, 25));
    const res = await postJson("/api/beispiel/log", { text: "  Zeile eins\n   Zeile zwei  " });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("sessions/2026-08-19.md"), "utf8");
    expect(raw.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("inserts before ## Threads when the section exists", async () => {
    setNow(() => new Date(2026, 0, 15, 23, 0)); // the committed example session
    const res = await postJson("/api/beispiel/log", { text: "Nachtrag nach dem Cliffhanger" });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("sessions/2026-01-15.md"), "utf8");
    expect(raw).toContain(
      "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread\n- 23:00 Nachtrag nach dem Cliffhanger\n\n## Threads\n",
    );
    // Threads content untouched
    expect(raw).toContain("- [ ] Wer bezahlt die Schmuggler?");
  });

  test("400 on empty or missing text", async () => {
    expect((await postJson("/api/beispiel/log", { text: "" })).status).toBe(400);
    expect((await postJson("/api/beispiel/log", { text: "   \n " })).status).toBe(400);
    expect((await postJson("/api/beispiel/log", {})).status).toBe(400);
    expect((await postJson("/api/beispiel/log", { text: 42 })).status).toBe(400);
  });
});

describe("scenes_played maintenance (POST log with sceneId)", () => {
  const REL = "sessions/2026-08-23.md";

  test("first log with a sceneId adds it to scenes_played", async () => {
    setNow(() => new Date(2026, 7, 23, 19, 0));
    expect((await postJson("/api/beispiel/session/start")).status).toBe(200);
    const res = await postJson("/api/beispiel/log", {
      text: "Ankunft",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival"]);
    const raw = await readFile(absOf(REL), "utf8");
    expect(raw).toContain("scenes_played: [lighthouse-arrival]\n");
    expect(topLevelKeys(raw)).toEqual(["id", "started", "scenes_played"]);
    // frontmatter rewrite left the Log section intact
    expect(raw.endsWith("## Log\n\n- 19:00 (lighthouse-arrival) Ankunft\n")).toBe(true);
  });

  test("second log with the same sceneId does not duplicate", async () => {
    setNow(() => new Date(2026, 7, 23, 19, 5));
    const res = await postJson("/api/beispiel/log", {
      text: "Immer noch da",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(REL), "utf8");
    expect(raw).toContain("scenes_played: [lighthouse-arrival]\n");
    expect(raw).not.toContain("lighthouse-arrival, lighthouse-arrival");
    expect(
      raw.endsWith("- 19:00 (lighthouse-arrival) Ankunft\n- 19:05 (lighthouse-arrival) Immer noch da\n"),
    ).toBe(true);
  });

  test("a different sceneId is appended in first-played order", async () => {
    setNow(() => new Date(2026, 7, 23, 19, 10));
    const res = await postJson("/api/beispiel/log", {
      text: "Erwischt",
      sceneId: "smuggler-captured",
    });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.scenes_played).toEqual(["lighthouse-arrival", "smuggler-captured"]);
    const raw = await readFile(absOf(REL), "utf8");
    expect(raw).toContain("scenes_played: [lighthouse-arrival, smuggler-captured]\n");
  });

  test("log without sceneId leaves scenes_played untouched", async () => {
    setNow(() => new Date(2026, 7, 23, 19, 15));
    const res = await postJson("/api/beispiel/log", { text: "Pause" });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(REL), "utf8");
    expect(raw).toContain("scenes_played: [lighthouse-arrival, smuggler-captured]\n");
    expect(raw.endsWith("- 19:15 Pause\n")).toBe(true);
  });

  test("a session file without scenes_played gains the key on first sceneId-log", async () => {
    const rel = "sessions/2026-08-24.md";
    await writeFile(
      absOf(rel),
      "---\nid: 2026-08-24\nstarted: 2026-08-24T19:00\n---\n\n## Log\n",
      "utf8",
    );
    setNow(() => new Date(2026, 7, 24, 19, 30));
    const res = await postJson("/api/beispiel/log", {
      text: "Los geht es",
      sceneId: "lighthouse-arrival",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf(rel), "utf8");
    // key appended after the existing ones (documented degrade path)
    expect(topLevelKeys(raw)).toEqual(["id", "started", "scenes_played"]);
    expect(raw).toContain("scenes_played: [lighthouse-arrival]\n");
    expect(raw).toContain("started: 2026-08-24T19:00\n");
    expect(raw.endsWith("## Log\n\n- 19:30 (lighthouse-arrival) Los geht es\n")).toBe(true);
  });
});

describe("POST /api/:campaign/session/end", () => {
  test("sets ended via the raw-patch mechanism, log untouched", async () => {
    setNow(() => new Date(2026, 7, 19, 23, 45));
    const res = await postJson("/api/beispiel/session/end");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.ended).toBe("2026-08-19T23:45");
    const raw = await readFile(absOf("sessions/2026-08-19.md"), "utf8");
    expect(topLevelKeys(raw)).toEqual(["id", "started", "scenes_played", "ended"]);
    expect(raw).toContain("started: 2026-08-19T21:05\n");
    expect(raw).toContain("ended: 2026-08-19T23:45\n");
    // the log lines appended earlier survive byte-identically
    expect(raw.endsWith("- 21:25 Zeile eins Zeile zwei\n")).toBe(true);
  });

  test("second end keeps the first ended (idempotent)", async () => {
    setNow(() => new Date(2026, 7, 19, 23, 59));
    const res = await postJson("/api/beispiel/session/end");
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.frontmatter.ended).toBe("2026-08-19T23:45");
  });

  test("404 without a session today", async () => {
    setNow(() => new Date(2026, 7, 22, 22, 0));
    const res = await postJson("/api/beispiel/session/end");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe("POST /api/:campaign/inbox", () => {
  test("appends `- text` to the existing inbox.md", async () => {
    const before = await readFile(absOf("inbox.md"), "utf8");
    const res = await postJson("/api/beispiel/inbox", { text: "Schmied beobachten #thread" });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("inbox.md"), "utf8");
    expect(raw.startsWith(before)).toBe(true); // append-only
    expect(raw.endsWith("- Schmied beobachten #thread\n")).toBe(true);
    // visible in a subsequent GET with fresh mtimeMs
    const file = await getFile("inbox.md");
    expect(file.raw).toBe(raw);
    expect(file.mtimeMs).toBe((await stat(absOf("inbox.md"))).mtimeMs);
  });

  test("creates inbox.md with a # Inbox heading when missing", async () => {
    await rm(absOf("inbox.md"));
    const res = await postJson("/api/beispiel/inbox", { text: "Erste Idee" });
    expect(res.status).toBe(200);
    const raw = await readFile(absOf("inbox.md"), "utf8");
    expect(raw).toBe("# Inbox\n\n- Erste Idee\n");
  });

  test("400 on empty text", async () => {
    expect((await postJson("/api/beispiel/inbox", { text: "  " })).status).toBe(400);
    expect((await postJson("/api/beispiel/inbox", {})).status).toBe(400);
  });

  test("404 for an unknown campaign", async () => {
    expect((await postJson("/api/nope/inbox", { text: "x" })).status).toBe(404);
    expect((await postJson("/api/nope/session/start")).status).toBe(404);
  });
});

// The meta dialog of issue #34 edits an EXISTING _campaign.md through
// PATCH /frontmatter (covered above). This endpoint only closes the gap where
// there is no file yet — hence a second campaign directory without one.
describe("POST /api/:campaign/campaign-meta", () => {
  const FRESH = "frischling";

  beforeEach(async () => {
    await rm(path.join(tmpRoot, FRESH), { recursive: true, force: true });
    await mkdir(path.join(tmpRoot, FRESH), { recursive: true });
  });

  test("creates _campaign.md with id, name and description", async () => {
    const res = await postJson(`/api/${FRESH}/campaign-meta`, {
      name: "Die Aschekönige",
      description: "Eine Wüstenkampagne um verschüttete Städte.",
    });
    expect(res.status).toBe(200);
    const file = (await res.json()) as FileResponse;
    expect(file.path).toBe("_campaign.md");
    expect(file.kind).toBe("campaign");
    expect(file.frontmatter.name).toBe("Die Aschekönige");

    const raw = await readFile(path.join(tmpRoot, FRESH, "_campaign.md"), "utf8");
    // The id is the DIRECTORY name — never client input.
    expect(raw).toBe(
      "---\nid: frischling\nname: Die Aschekönige\ndescription: Eine Wüstenkampagne um verschüttete Städte.\n---\n",
    );

    // The campaign list serves the new metadata right away.
    const list = (await (await app.request("/api/campaigns")).json()) as Array<
      Record<string, unknown>
    >;
    expect(list.find((c) => c.id === FRESH)).toMatchObject({
      name: "Die Aschekönige",
      description: "Eine Wüstenkampagne um verschüttete Städte.",
    });
  });

  test("a blank description writes no key at all", async () => {
    const res = await postJson(`/api/${FRESH}/campaign-meta`, {
      name: "Nur ein Name",
      description: "   ",
    });
    expect(res.status).toBe(200);
    const raw = await readFile(path.join(tmpRoot, FRESH, "_campaign.md"), "utf8");
    expect(raw).toBe("---\nid: frischling\nname: Nur ein Name\n---\n");
  });

  test("409 when the file exists — the existing one is never touched", async () => {
    const before = await readFile(absOf("_campaign.md"), "utf8");
    const res = await postJson("/api/beispiel/campaign-meta", { name: "Überschrieben" });
    expect(res.status).toBe(409);
    expect((await res.json()) as { path: string }).toMatchObject({ path: "_campaign.md" });
    expect(await readFile(absOf("_campaign.md"), "utf8")).toBe(before);
  });

  test("400 on a missing, blank or non-string name and a non-string description", async () => {
    expect((await postJson(`/api/${FRESH}/campaign-meta`, {})).status).toBe(400);
    expect((await postJson(`/api/${FRESH}/campaign-meta`, { name: "  " })).status).toBe(400);
    expect((await postJson(`/api/${FRESH}/campaign-meta`, { name: 42 })).status).toBe(400);
    expect(
      (await postJson(`/api/${FRESH}/campaign-meta`, { name: "Ok", description: 7 })).status,
    ).toBe(400);
    expect(
      (await postJson(`/api/${FRESH}/campaign-meta`, { name: "Ok", id: "gehackt" })).status,
    ).toBe(400);
    // None of the rejected requests created a file.
    expect((await postJson(`/api/${FRESH}/campaign-meta`, { name: "Danach" })).status).toBe(200);
  });

  test("404 for an unknown campaign", async () => {
    expect((await postJson("/api/nope/campaign-meta", { name: "x" })).status).toBe(404);
  });
});
