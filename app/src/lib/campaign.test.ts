import { describe, expect, test } from "bun:test";
import type { CampaignSummary } from "@grimoire/shared/types";

import { pickLastCampaign } from "./campaign";

const c = (id: string, lastSession?: string): CampaignSummary =>
  lastSession === undefined ? { id } : { id, lastSession };

describe("pickLastCampaign", () => {
  test("no campaign at all → undefined (empty state)", () => {
    expect(pickLastCampaign([])).toBeUndefined();
  });

  test("exactly one campaign always wins — with or without sessions", () => {
    expect(pickLastCampaign([c("beispiel", "2026-01-15")])).toBe("beispiel");
    expect(pickLastCampaign([c("beispiel")])).toBe("beispiel");
  });

  test("newest session wins over the alphabetically first id", () => {
    expect(pickLastCampaign([c("alpha", "2026-01-15"), c("zeta", "2026-06-01")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", "2026-06-01"), c("alpha", "2026-01-15")])).toBe("zeta");
  });

  test("campaigns without a session rank behind every campaign with one", () => {
    expect(pickLastCampaign([c("alpha"), c("zeta", "2020-01-01")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", "2020-01-01"), c("alpha")])).toBe("zeta");
  });

  test("tie on the session id → alphabetically first", () => {
    expect(pickLastCampaign([c("zeta", "2026-03-09"), c("alpha", "2026-03-09")])).toBe("alpha");
  });

  test("nobody has a session → alphabetically first", () => {
    expect(pickLastCampaign([c("zeta"), c("beta"), c("alpha")])).toBe("alpha");
  });

  test("degrades on unexpected values: empty lastSession counts as none", () => {
    expect(pickLastCampaign([c("alpha", ""), c("zeta", "2026-01-15")])).toBe("zeta");
    expect(pickLastCampaign([c("zeta", ""), c("alpha", "")])).toBe("alpha");
  });
});
