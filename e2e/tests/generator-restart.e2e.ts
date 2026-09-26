// Critical path 6, the half that only a real restart can show:
// generator jobs are ROWS, so they outlive the process that started them.
//
// Like the seed spec this cannot use the per-test `server` fixture:
// it needs TWO servers, one after the other, on the SAME data directory — the
// second boot is the restart. Both talk to the run's real stub LLM through the
// real provider; the only thing arranged is WHEN the stub answers
// (TRIGGER.slow holds the reply, so a job can be caught while it truly runs).
//
// Two claims, and they are the two halves of what "persistent" has to mean:
//
//   1. a run that was IN FLIGHT cannot come back — its provider call died with
//      the process — so the boot fails it with an error code the app has a
//      sentence for, instead of leaving a `running` row the app polls forever;
//   2. a FINISHED run comes back whole — result, warnings and the review edits
//      — and is still acceptable afterwards. That is the loss this guards
//      against: a deploy between „fertig" and „Übernehmen" must not throw a
//      good generation away.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

import {
  LOCATION_STUB_ID,
  NPC_STUB_ID,
  NPC_STUB_NAME,
  SCENE_ID,
  TRIGGER,
} from "../fixtures/replies";
import { pristineDir, runDir } from "../support/paths";
import { expect, seedCampaigns, startGrimoireServer, test } from "../support/test";
import { apiFor } from "../support/api";
import {
  generatorJobPath,
  patchGeneratorJob,
  readGeneratorJob,
  startGeneratorJob,
  waitForGeneratorJob,
} from "../support/generator-job";
import { getNpc } from "../support/npc";
import { getScene, sceneExists } from "../support/scene";

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn.`;

/** A title no reply fixture spells, so only the DM's edit can produce it. */
const EDITED_TITLE = "Nachtwache am Kai, nach dem Neustart";

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
    // The start answers with the job itself.
    const started = await startGeneratorJob(api, {
      kind: "scene",
      chapter: "01-salzhafen",
      sourceText: `${SOURCE}\n\n${TRIGGER.slow}`,
    });
    jobId = started.id;
    expect(started).toMatchObject({ status: "running", kind: "scene" });
    const running = await readGeneratorJob(api);
    expect(running).toMatchObject({ id: jobId, status: "running", kind: "scene" });
  } finally {
    // The restart. Everything about that provider call goes with it.
    await first.proc.stop();
  }

  // --- boot 2: the same database --------------------------------------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const failed = await readGeneratorJob(api);
    // The job is still THERE, and it says what happened.
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
    expect(await sceneExists(api, SCENE_ID)).toBe(false);
    const discarded = await api.fetch(generatorJobPath(api, jobId), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: failed!.rev }),
    });
    expect(discarded.status).toBe(200);
    expect(await readGeneratorJob(api)).toBeNull();

    // The job is its own resource (ADR #31): the generator's former
    // addresses answer 404.
    expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);
    const oldApply = await api.fetch("campaigns/beispiel/generate/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenes: [], jobId }),
    });
    expect(oldApply.status).toBe(404);
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
  let before: GeneratorJob;
  try {
    const api = apiFor(first.handle.url);
    await startGeneratorJob(api, { kind: "scene", chapter: "01-salzhafen", sourceText: SOURCE });
    const finished = await waitForGeneratorJob(api);
    expect(finished.status).toBe("done");

    const scenes = finished.result!.scenes;
    expect(scenes.map((s) => s.id)).toEqual([SCENE_ID]);
    // The job's PATCH is the one way an edit reaches the job, and it carries
    // the scene's change by its id — here a field and the text, so the
    // restart has something of each to bring back.
    before = await patchGeneratorJob(api, finished.id, {
      rev: finished.rev,
      sceneEdits: {
        [SCENE_ID]: { title: EDITED_TITLE, body: `${scenes[0]!.body}${edited}` },
      },
    });
    // Still nothing written — the review has not been applied.
    expect(await sceneExists(api, SCENE_ID)).toBe(false);
  } finally {
    await first.proc.stop();
  }

  // --- boot 2: the review is back, unchanged, and can be applied ------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const after = (await readGeneratorJob(api))!;
    expect(after.id).toBe(before.id);
    expect(after.rev).toBe(before.rev);
    expect(after.status).toBe("done");
    expect(after.kind).toBe("scene");
    expect(after.chapter).toBe("01-salzhafen");
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.finishedAt).toBe(before.finishedAt);
    expect(after.result).toEqual(before.result);
    // The DM's own change came back with it, field by field.
    const edit = after.sceneEdits[SCENE_ID]!;
    expect(edit).toMatchObject({ title: EDITED_TITLE });
    expect(edit.body).toContain(edited.trim());

    // The accept names the scene AND the npc and location it references: a
    // scene cannot name anything that does not exist (ADR #19). The server
    // lays the stored change on top of the run's scene — the accept carries
    // ids, not proposals.
    const accepted = await patchGeneratorJob(api, after.id, {
      rev: after.rev,
      review: {
        writtenScenes: [SCENE_ID],
        writtenNpcs: [NPC_STUB_ID],
        writtenLocations: [LOCATION_STUB_ID],
      },
    });
    // Nothing is left open, so the answer is the job as it ended.
    expect(accepted.review.writtenScenes).toEqual([SCENE_ID]);
    expect(accepted.review.writtenNpcs).toEqual([NPC_STUB_ID]);
    expect(accepted.review.writtenLocations).toEqual([LOCATION_STUB_ID]);
    expect((await getNpc(api, NPC_STUB_ID)).name).toBe(NPC_STUB_NAME);
    const stored = await getScene(api, SCENE_ID);
    // The field and the text as the DM left them before the restart.
    expect(stored.title).toBe(EDITED_TITLE);
    expect(stored.body).toContain(edited.trim());
    expect(stored.status).toBe("draft");
    // Accepted means done: the job is gone, as after any accept that leaves
    // nothing open.
    expect(await readGeneratorJob(api)).toBeNull();
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});
