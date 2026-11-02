// Critical path 6: a scene run with supplementary material beside its source
// text (decisions/generator).
//
// The claims:
//
//   1. both fields of the start form load a local text file into the field;
//   2. the supplementary material reaches the outline call and the scene
//      calls whole — the stub echoes it back as a note of the run and of the
//      scene the supplement alone brings;
//   3. that scene is written from its supplement passage, carries no note
//      that a passage could not be matched, and stands between the source's
//      scenes once the run is accepted.
//
// The stub answers a prompt with a supplementary-material section with an
// outline of three scenes — the source's first sentence, the supplement's
// own scene, the source's last sentence — and writes the middle one from the
// passage its call carried (e2e/fixtures/replies.ts).

import {
  SUPPLEMENT_SCENE,
  SUPPLEMENT_SCENES,
  supplementEcho,
} from "../fixtures/replies";
import { expect, test } from "../support/test";
import { getGeneratorJob, readGeneratorJob } from "../support/generator-job";
import { applyScenes, expectStage, sceneProposal } from "../support/generator-review";
import { getScene } from "../support/scene";
import { ui } from "../support/ui";

const CHAPTER = "01-salt-harbour";

const SOURCE = `The party lands at the quay at dusk. Fenn waits by the crane with a
lantern. A storm rolls in over the bay at midnight.`;

const SUPPLEMENT = `The old lighthouse keeper asks every visitor a riddle.
Whoever answers it may climb the tower and watch the ghost ship pass.`;

/** A text file as the file picker hands it over. */
function textFile(name: string, text: string) {
  return { name, mimeType: "text/markdown", buffer: Buffer.from(text, "utf8") };
}

test("a scene run with supplementary material writes the supplement's own scene between the source's", async ({
  page,
  api,
}) => {
  type Tree = { chapters: Array<{ id: string; scenes: Array<{ id: string }> }> };
  const chapterScenes = async () =>
    (await api.get<Tree>("campaigns/example/tree")).chapters.find((c) => c.id === CHAPTER)!
      .scenes;
  const before = await chapterScenes();

  await page.goto("/campaigns/example/generate");

  // --- (1) both fields load a file, replacing what stood there -------------
  const source = page.getByLabel(ui("generate.input.sourceLabel"), { exact: true });
  const supplement = page.getByLabel(ui("generate.input.supplementLabel"), { exact: true });
  await source.fill("Something typed before.");
  await page.getByTestId("generate-source-file").setInputFiles(textFile("chapter.md", SOURCE));
  await expect(source).toHaveValue(SOURCE);
  await page
    .getByTestId("generate-supplement-file")
    .setInputFiles(textFile("expansion.txt", SUPPLEMENT));
  await expect(supplement).toHaveValue(SUPPLEMENT);

  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();
  // Nothing new besides the scenes: the review opens on the scene stage.
  await expectStage(page, "scenes");

  // --- (2) the material reached the outline call and the scene call --------
  const echo = supplementEcho(SUPPLEMENT);
  await expect(page.getByTestId("run-notes")).toContainText(echo);
  const own = sceneProposal(page, SUPPLEMENT_SCENE.id);
  await expect(own.getByTestId("part-notes")).toContainText(echo);

  // --- (3) written from its supplement passage, without a passage note -----
  const passage = SUPPLEMENT.replace(/\s+/g, " ");
  await expect(own).toContainText(passage);
  await expect(own.getByTestId("server-note")).toHaveCount(0);
  const job = await getGeneratorJob(api);
  expect(job.pipeline!.parts.map((part) => part.key)).toEqual(
    SUPPLEMENT_SCENES.map((scene) => `scene:${scene.id}`),
  );
  for (const part of job.pipeline!.parts) expect(part.serverNotes).toBeUndefined();

  // Accepted, the three stand in the chapter in outline order: the
  // supplement's scene between the source's two.
  await applyScenes(page).click();
  await expect(page.getByText(ui("generate.written.title.scene"))).toBeVisible();
  expect(await readGeneratorJob(api)).toBeNull();
  expect((await chapterScenes()).map((scene) => scene.id)).toEqual([
    ...before.map((scene) => scene.id),
    ...SUPPLEMENT_SCENES.map((scene) => scene.id),
  ]);
  const written = await getScene(api, SUPPLEMENT_SCENE.id);
  expect(written.body).toContain(passage);
});
