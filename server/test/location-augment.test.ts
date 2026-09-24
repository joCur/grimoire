// Augmenting a location on its own resource (ADR #31):
// `POST …/locations/:id/augment` starts the run, the job carries the
// location as read and as proposed, and `POST …/locations/:id/augment/apply`
// writes what the DM took.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { GenerateJob, Location, LocationProposal } from "@grimoire/shared";
import { locationProposalSchema } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import { ASSET_FILES, campaignRefIds, collectContext, loadAsset, setProviderForTests } from "../src/generator";
import {
  locationAugmentSystemPrompt,
  validateLocationAugmentReply,
} from "../src/location-augment";
import { parseLocationReply } from "../src/location-reply";
import {
  buildPrompt,
  EXISTING_ENTRY_HEADING,
  EXISTING_LOCATION_HEADING,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "../src/llm-provider";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "beispiel";
const TOWER = `/api/campaigns/${CAMPAIGN}/locations/leuchtturm`;

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: Array<{ req: GenerateRequest; corrections: CorrectionTurn[] }> = [];
  constructor(private replies: string[]) {}
  async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []): Promise<CompletionResult> {
    this.calls.push({ req, corrections: [...corrections] });
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("FakeProvider: no scripted reply left");
    return { text: reply, truncated: false };
  }
}

function useFake(replies: string[]): FakeProvider {
  const fake = new FakeProvider(replies);
  setProviderForTests(fake);
  return fake;
}

async function read(): Promise<Location> {
  const res = await app.request(TOWER);
  expect(res.status).toBe(200);
  return (await res.json()) as Location;
}

/** The reply a model gives: every field of the location, `over` applied, and the notes. */
function reply(stored: Location, over: Record<string, unknown> = {}, warnings: string[] = []): string {
  const { rev: _rev, ...fields } = stored;
  return JSON.stringify({ ...fields, ...over, warnings });
}

async function post(url: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Start a run on the location and wait for the job to leave `running`. */
async function runJob(body: Record<string, unknown>): Promise<GenerateJob> {
  const res = await post(`${TOWER}/augment`, body);
  expect(res.status).toBe(202);
  for (let i = 0; i < 200; i += 1) {
    const job = (await (await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).json()) as GenerateJob;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job never finished");
}

beforeAll(async () => {
  await seedStore();
});
afterAll(() => {
  dropStore();
});
afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
});

describe("the prompt", () => {
  test("the augmentation rule for a location plus the location's fields, one output format", async () => {
    const prompt = await locationAugmentSystemPrompt();
    expect(prompt).toContain("System-Prompt: Ort ergänzen");
    expect(prompt).toContain("Die Ergänzungsregel");
    expect(prompt).toContain("Vorhandenes bleibt Wort für Wort stehen");
    expect(prompt).toContain("## Die Felder des Orts");
    expect(prompt).toContain('"roll20Page"');
    expect(prompt.split("## Ausgabeformat").length - 1).toBe(1);
    expect(prompt.split("**Deutsche Orthografie**").length - 1).toBe(1);
  });

  test("the location prompts speak of the location and its fields", async () => {
    const create = await loadAsset(ASSET_FILES.location.systemPrompt);
    const augment = await locationAugmentSystemPrompt();
    for (const prompt of [create, augment]) {
      expect(prompt).not.toContain("Eigenschaft");
      expect(prompt).not.toContain("Eintrag");
      expect(prompt).not.toContain("roll20-page");
      expect(prompt).not.toContain("`properties`");
      expect(prompt).toContain("ä, ö, ü und ß stehen als genau diese Zeichen");
    }
  });

  test("the few-shot is a location reply with every field, and it reads", async () => {
    const raw = await loadAsset(ASSET_FILES.location.fewShotTarget);
    const example = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(locationProposalSchema.shape)) {
      expect(Object.hasOwn(example, key), key).toBe(true);
    }
    expect(JSON.stringify(example)).toMatch(/[äöüß]/);
    expect(parseLocationReply(raw).ok).toBe(true);
  });

  test("the existing location travels as its own block — no entry block", () => {
    const location: LocationProposal = { id: "leuchtturm", name: "Leuchtturm", body: "## Text\n" };
    const prompt = buildPrompt({
      systemPrompt: "SYS",
      fewShotTarget: "FEWSHOT",
      knowledge: "",
      glossary: "",
      context: { npcs: [], locations: [] },
      sourceText: "source",
      existingLocation: location,
    });
    expect(prompt).toContain(`${EXISTING_LOCATION_HEADING} (leuchtturm)`);
    expect(prompt).toContain('"name": "Leuchtturm"');
    expect(prompt).not.toContain(EXISTING_ENTRY_HEADING);
    expect(prompt.indexOf("FEWSHOT")).toBeLessThan(prompt.indexOf(EXISTING_LOCATION_HEADING));
    expect(prompt.indexOf(EXISTING_LOCATION_HEADING)).toBeLessThan(prompt.indexOf("## Quelltext"));
  });
});

describe("the run", () => {
  test("202, and the job carries the location as read and as proposed", async () => {
    const stored = await read();
    const body = `${stored.body}\n> [!secret] Unter der Treppe liegt ein Logbuch.\n`;
    const fake = useFake([reply(stored, { roll20Page: "Leuchtturm (Karte)", body }, ["Logbuch ergänzt"])]);
    const job = await runJob({ instruction: "Ein Geheimnis ergänzen" });
    expect(job.status).toBe("done");
    expect(job.kind).toBe("location-augment");
    expect(job.location).toBe("leuchtturm");
    expect(job.target).toBeUndefined();
    expect(job.augmentResult).toBeUndefined();
    const result = job.locationAugmentResult!;
    expect(result.id).toBe("leuchtturm");
    expect(result.rev).toBe(stored.rev);
    const { rev: _rev, ...current } = stored;
    expect(result.current).toEqual(current);
    expect(result.proposed.roll20Page).toBe("Leuchtturm (Karte)");
    expect(result.proposed.body).toContain("Logbuch");
    expect(result.warnings).toEqual(["Logbuch ergänzt"]);

    const req = fake.calls[0]!.req;
    expect(req.existingLocation).toEqual(current);
    expect(req.existingEntry).toBeUndefined();
    expect(req.jsonSchema?.name).toBe("augmented_location");
    expect(req.systemPrompt).toContain("System-Prompt: Ort ergänzen");
    expect(req.fewShotTarget).toContain('"id": "leuchtturm"');
    expect(req.context.chapter).toBeUndefined();
  });

  test("400 without source text and instruction, 404 for an unknown location", async () => {
    expect((await post(`${TOWER}/augment`, {})).status).toBe(400);
    expect((await post(`${TOWER}/augment`, { instruction: "  " })).status).toBe(400);
    expect((await post(`${TOWER}/augment`, { path: "x", instruction: "x" })).status).toBe(400);
    const unknown = await post(`/api/campaigns/${CAMPAIGN}/locations/gibt-es-nicht/augment`, {
      instruction: "x",
    });
    expect(unknown.status).toBe(404);
  });

  test("a status or a changed id goes back to the model", async () => {
    const stored = await read();
    const refIds = campaignRefIds(await collectContext(CAMPAIGN));
    const withStatus = validateLocationAugmentReply(reply(stored, { status: "alive" }), stored, refIds);
    expect(withStatus.ok).toBe(false);
    if (!withStatus.ok) expect(withStatus.errors.join(" ")).toContain('"status"');
    const renamed = validateLocationAugmentReply(reply(stored, { id: "turm" }), stored, refIds);
    expect(renamed.ok).toBe(false);
    if (!renamed.ok) expect(renamed.errors.join(" ")).toContain('die id bleibt "leuchtturm"');
    const unknownRef = validateLocationAugmentReply(
      reply(stored, { body: `${stored.body}\n[[gibt-es-nicht]]\n` }),
      stored,
      refIds,
    );
    expect(unknownRef.ok).toBe(false);
  });
});

describe("accepting", () => {
  test("the fields taken and the body land in ONE write, and the job is gone", async () => {
    const before = await read();
    useFake([reply(before)]);
    const job = await runJob({ instruction: "x" });
    const body = `${before.body}\n- ein Logbuch unter der Treppe\n`;
    const res = await post(`${TOWER}/augment/apply`, {
      rev: before.rev,
      roll20Page: "Leuchtturm (neu)",
      body,
      jobId: job.id,
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as Location;
    expect(written.roll20Page).toBe("Leuchtturm (neu)");
    expect(written.body).toContain("ein Logbuch unter der Treppe");
    expect(written.rev).toBe(before.rev + 1);
    expect(await read()).toEqual(written);
    expect((await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`)).status).toBe(404);
  });

  test("a stale rev is 409 with the current location, and nothing is written", async () => {
    const before = await read();
    const res = await post(`${TOWER}/augment/apply`, { rev: before.rev - 1, name: "Anders" });
    expect(res.status).toBe(409);
    const conflict = (await res.json()) as { code: string; location: Location };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.location).toEqual(before);
    expect(await read()).toEqual(before);
  });

  test("no force, no id, no foreign key — and taking nothing is a 400", async () => {
    const before = await read();
    for (const body of [
      { rev: before.rev, name: "X", force: true },
      { rev: before.rev, id: "leuchtturm", name: "X" },
      { rev: before.rev, properties: { name: "X" } },
      { rev: before.rev, path: "x", name: "X" },
      { rev: before.rev },
    ]) {
      expect((await post(`${TOWER}/augment/apply`, body)).status).toBe(400);
    }
    expect(await read()).toEqual(before);
  });
});
