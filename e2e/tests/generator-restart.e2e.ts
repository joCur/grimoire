// Critical path 6, the half that only a real restart can show:
// generator jobs are ROWS, so they outlive the process that started them.
//
// Like the first-migration spec this cannot use the per-test `server` fixture:
// it needs TWO servers, one after the other, on the SAME data directory — the
// second boot is the restart. Both talk to the run's real stub LLM through the
// real provider; the only thing arranged is WHEN the stub answers
// (TRIGGER.slow holds the reply, so a job can be caught while it truly runs).
//
// Two claims, and they are the two halves of what "persistent" has to mean:
//
//   1. a run that was IN FLIGHT cannot come back — its provider call died with
//      the process — so the boot fails it with a German sentence the app
//      shows, instead of leaving a `running` row the app polls forever;
//   2. a FINISHED run comes back whole — result, warnings and the review edits
//      — and is still applyable afterwards. That is the loss this guards
//      against: a deploy between „fertig" and „Übernehmen" used to throw a good
//      generation away.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { openSqlite } from "../../server/src/db/driver";
import { LOCATION_STUB_ID, SCENE_ID, TRIGGER } from "../fixtures/replies";
import { pristineDir, runDir } from "../support/paths";
import { apiFor, expect, seedCampaigns, startGrimoireServer, test, type Api } from "../support/test";

/**
 * How the review addresses the draft (`<chapter>/<id>`) and where it LIVES
 * once accepted — the group segment is its `location`.
 */
const DRAFT_PATH = `01-salzhafen/${SCENE_ID}`;
const SCENE_PATH = `01-salzhafen/${LOCATION_STUB_ID}/${SCENE_ID}`;

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn.`;

/** A title no reply fixture spells, so only the DM's edit can produce it. */
const EDITED_TITLE = "Nachtwache am Kai, nach dem Neustart";

/** One scene draft on the wire: the two halves and the address (ADR #24). */
interface SceneDraft {
  path: string;
  properties: Record<string, unknown>;
  body: string;
}

/** One stored edit: the halves the DM replaced, each of them whole. */
interface DraftEdit {
  properties?: Record<string, unknown>;
  body?: string;
}

/** GET …/generate/job — null on the 404 "there is none". */
async function job(api: Api): Promise<Record<string, unknown> | null> {
  const res = await api.fetch("campaigns/beispiel/generate/job");
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** Poll until the job leaves `running` (the stub answers in well under 30s). */
async function waitForFinish(api: Api): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await job(api);
    if (current === null) throw new Error("the job disappeared while waiting");
    if (current.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the job never finished");
}

/** A run directory of this test's own, plus its cleanup. */
async function ownDataDir(testId: string, workerIndex: number): Promise<string> {
  const dir = path.join(runDir(), `w${workerIndex}`, testId, "data");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // The boot imports nothing — the fixture campaign is put in
  // by the seed CLI, once, before either boot of this spec.
  await seedCampaigns(pristineDir(), dir);
  return dir;
}

test("a run interrupted by a restart is reported as failed, not left spinning", async ({}, testInfo) => {
  const dataDir = await ownDataDir(testInfo.testId, testInfo.workerIndex);

  // --- boot 1: start a run the stub will never answer -----------------------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let jobId: string;
  try {
    const api = apiFor(first.handle.url);
    const started = await api.send<{ jobId: string }>("POST", "campaigns/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: `${SOURCE}\n\n${TRIGGER.slow}`,
    });
    jobId = started.jobId;
    const running = await job(api);
    expect(running).toMatchObject({ id: jobId, status: "running", kind: "scene" });
  } finally {
    // The restart. Everything about that provider call goes with it.
    await first.proc.stop();
  }

  // --- boot 2: the same database --------------------------------------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const failed = await job(api);
    // The job is still THERE — a restart used to answer 404 here — and it
    // says what happened.
    expect(failed).toMatchObject({ id: jobId, status: "failed" });
    expect(failed!.finishedAt).toEqual(expect.any(String));
    const error = failed!.error as {
      status: number;
      body: { code?: string; error: string };
    };
    expect(error.status).toBe(503);
    // Language-free: the stable code is the contract, the
    // English text next to it the technical fallback. The SENTENCE the DM
    // reads is the app's (`server.job_restarted` in app/src/i18n) — the
    // language spec asserts that side.
    expect(error.body.code).toBe("job_restarted");
    expect(error.body.error).toBe(
      "the server was restarted while the job was running — start the job again",
    );
    // Nothing was written, and a new run may start right away (no stuck gate).
    expect(await api.exists(SCENE_PATH)).toBe(false);
    expect((await api.fetch("campaigns/beispiel/generate/job", { method: "DELETE" })).status).toBe(200);
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});

test("a finished job survives a restart whole and is still applyable", async ({}, testInfo) => {
  const dataDir = await ownDataDir(testInfo.testId, testInfo.workerIndex);
  const edited = `<!-- nach dem Neustart noch da -->\n`;

  // --- boot 1: run to completion, then edit a draft in the review ----------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let before: Record<string, unknown>;
  try {
    const api = apiFor(first.handle.url);
    await api.send("POST", "campaigns/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: SOURCE,
    });
    before = await waitForFinish(api);
    expect(before.status).toBe("done");

    const result = before.result as { scenes: SceneDraft[] };
    expect(result.scenes.map((s) => s.path)).toEqual([DRAFT_PATH]);
    // The review PATCH is the one way an edit reaches the job, and it carries
    // the halves of a draft one by one (ADR #24) — here both, so the restart
    // has something of each to bring back.
    await api.send("PATCH", `campaigns/beispiel/generate/job/${before.id as string}/review`, {
      rev: (before.rev as number | undefined) ?? 0,
      edits: {
        [DRAFT_PATH]: {
          properties: { ...result.scenes[0]!.properties, title: EDITED_TITLE },
          body: `${result.scenes[0]!.body}${edited}`,
        },
      },
    });
    // Still nothing written — the review has not been applied.
    expect(await api.exists(SCENE_PATH)).toBe(false);
  } finally {
    await first.proc.stop();
  }

  // --- boot 2: the review is back, unchanged, and can be applied ------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const after = (await job(api))!;
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("done");
    expect(after.kind).toBe("scene");
    expect(after.chapter).toBe("01-salzhafen");
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.finishedAt).toBe(before.finishedAt);
    expect(after.result).toEqual(before.result);
    // The DM's own edit came back with it, per half and in the current shape.
    const edit = (after.draftEdits as Record<string, DraftEdit>)[DRAFT_PATH]!;
    expect(edit.properties).toMatchObject({ title: EDITED_TITLE });
    expect(edit.body).toContain(edited.trim());

    // The scene AND the entries it references: a proposal is applied as one
    // batch, because a scene cannot name an entry that does not exist
    // (ADR #19). The payload is the run's drafts with the stored edits folded
    // in, which is what the review screen sends.
    const result = after.result as { scenes: SceneDraft[]; stubs: unknown[] };
    const written = await api.send<{ written: string[] }>("POST", "campaigns/beispiel/generate/apply", {
      scenes: result.scenes.map((scene) => ({ ...scene, ...edit })),
      stubs: result.stubs,
      jobId: after.id,
    });
    expect(written.written).toContain(SCENE_PATH);
    const stored = await api.file(SCENE_PATH);
    // Both halves as the DM left them before the restart.
    expect(stored.properties.title).toBe(EDITED_TITLE);
    expect(stored.body).toContain(edited.trim());
    expect(stored.properties.status).toBe("draft");
    // Applied means done: the job is discarded, as after any successful apply.
    expect(await job(api)).toBeNull();
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});

/**
 * The third thing a boot does to a job row: a job whose stored drafts are in
 * the OLD shape — one markdown text per draft, properties block included — is
 * `failed` afterwards and never converted (ADR #24). Parsing that text back is
 * exactly the round trip the format change removed, and a half-converted draft
 * would be written into the campaign.
 *
 * The row is PLANTED, because nothing in the repo writes that shape any more:
 * the run of the first boot is real, and between the boots its payload is
 * rewritten into the shape a job from before the change has. That is the one
 * place in the suite that writes to a database directly — nothing is running
 * on it at that moment, and there is no API for putting a stale row there.
 */
test("a job in the old draft format is failed at boot, and the app says why", async ({
  browser,
}, testInfo) => {
  const dataDir = await ownDataDir(testInfo.testId, testInfo.workerIndex);

  // --- boot 1: a real run, finished ----------------------------------------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let jobId: string;
  try {
    const api = apiFor(first.handle.url);
    await api.send("POST", "campaigns/beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: SOURCE,
    });
    const done = await waitForFinish(api);
    expect(done.status).toBe("done");
    jobId = done.id as string;
  } finally {
    await first.proc.stop();
  }

  // --- the row, back-dated to the shape from before the format change -------
  await plantLegacyDrafts(path.join(dataDir, "grimoire.db"), jobId);

  // --- boot 2: the boot refuses the row ------------------------------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const failed = (await job(api))!;
    expect(failed).toMatchObject({ id: jobId, status: "failed" });
    expect(failed.finishedAt).toEqual(expect.any(String));
    const error = failed.error as { status: number; body: { code?: string; error: string } };
    // 409 and not 503: the run itself was fine, its stored form is what this
    // server cannot honour.
    expect(error.status).toBe(409);
    expect(error.body.code).toBe("job_draft_format");
    expect(error.body.error).toBe(
      "this job predates the current draft format — its drafts cannot be " +
        "reviewed or accepted any more; start the run again",
    );
    // Nothing was converted and nothing was written.
    expect(await api.exists(SCENE_PATH)).toBe(false);

    // …and the DM reads a sentence, not a code. The generate view shows a
    // failed job's message in the run's own mode, which is the scene one.
    const context = await browser.newContext({ baseURL: second.handle.url });
    const page = await context.newPage();
    try {
      await page.goto("/campaigns/beispiel/generate");
      await expect(
        page.getByText(
          "Dieser Lauf stammt aus einem älteren Entwurfsformat und kann nicht mehr " +
            "übernommen werden — bitte neu erzeugen.",
        ),
      ).toBeVisible();
      // The way out is a new run, so the form is there and usable.
      await expect(page.getByRole("button", { name: "Entwürfe generieren" })).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});

/**
 * Rewrite one finished job's stored payload into the OLD draft shape: every
 * draft as one `markdown` text with a properties block on top, and every
 * review edit as a plain string. Those are the two halves of what the boot
 * check looks at, so the test cannot pass on one of them alone.
 *
 * Opened with the server's own driver, like the `db` fixture — the suite keeps
 * no second SQLite dependency.
 */
async function plantLegacyDrafts(dbFile: string, jobId: string): Promise<void> {
  const client = await openSqlite(dbFile);
  try {
    const row = client.prepare("SELECT result FROM generate_jobs WHERE id = ?").all(jobId)[0] as {
      result: string;
    };
    const result = JSON.parse(row.result) as Record<string, unknown>;
    for (const key of ["scenes", "stubs"]) {
      const drafts = result[key];
      if (Array.isArray(drafts)) result[key] = drafts.map(asLegacyDraft);
    }
    client
      .prepare("UPDATE generate_jobs SET result = ?, draft_edits = ? WHERE id = ?")
      .run(JSON.stringify(result), JSON.stringify({ [DRAFT_PATH]: "# Ein alter Entwurf\n" }), jobId);
  } finally {
    client.close();
  }
}

/** One draft as the old format held it: the two halves rendered into one text. */
function asLegacyDraft(draft: unknown): Record<string, unknown> {
  const { properties, body, ...rest } = draft as SceneDraft & Record<string, unknown>;
  const block = Object.entries(properties)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return { ...rest, markdown: `---\n${block}\n---\n\n${body}` };
}
