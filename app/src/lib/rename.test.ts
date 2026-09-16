// Tests for the pure half of „Umbenennen" (issue #30): which files offer the
// action, the id rules the dialog blocks on before it ever asks the server,
// and where the reading view has to go after the cascade.

import type { EntityKind } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { ApiError, type UsageGroup, type UsageReport } from "@/api";
import {
  canSubmitNewId,
  changedCountLabel,
  newIdError,
  renameErrorMessage,
  renameKindLabel,
  renamedPath,
  renameTargetFor,
  usageGroupLabel,
  usageSummary,
  usageTotalLabel,
} from "@/lib/rename";
import { translator } from "@/i18n/format";

// The language the assertions below are written in (issue #69): the helpers
// take the translator as an argument, so a test says so explicitly instead of
// leaning on a default.
const t = translator("de");

function file(path: string, kind: EntityKind, properties: Record<string, unknown> = {}) {
  return { path, kind, properties };
}

describe("renameTargetFor", () => {
  test("npc/location/scene use the properties id", () => {
    expect(renameTargetFor(file("npcs/jorna", "npc", { id: "jorna" }))).toEqual({
      kind: "npc",
      oldId: "jorna",
    });
    expect(renameTargetFor(file("locations/leuchtturm", "location", { id: "leuchtturm" })))
      .toEqual({ kind: "location", oldId: "leuchtturm" });
    // the scene id is NOT the file name — the properties wins
    expect(
      renameTargetFor(
        file("01-salzhafen/hafen/ankunft-leuchtturm", "scene", { id: "lighthouse-arrival" }),
      ),
    ).toEqual({ kind: "scene", oldId: "lighthouse-arrival" });
  });

  test("no id, no rename — the address is not guessed at", () => {
    // Cannot happen against the real API (`id` is the row's primary key and
    // every properties mapping carries it), so the view degrades quietly
    // instead of deriving an id from the address.
    expect(renameTargetFor(file("npcs/fenn", "npc"))).toBeUndefined();
  });

  test("a chapter is renamed by its address, which is its id", () => {
    expect(renameTargetFor(file("01-salzhafen", "chapter", { id: "01-salzhafen" })))
      .toEqual({ kind: "chapter", oldId: "01-salzhafen" });
    // a deeper address is not a chapter we can rename
    expect(renameTargetFor(file("01-salzhafen/hafen", "chapter"))).toBeUndefined();
  });

  test("kinds without a renameable id offer nothing", () => {
    for (const [path, kind] of [
      ["sessions/2026-01-15", "session"],
      ["inbox", "inbox"],
      ["glossary", "glossary"],
      ["campaign", "campaign"],
      ["weird", "unknown"],
    ] as Array<[string, EntityKind]>) {
      expect(renameTargetFor(file(path, kind, { id: "x" }))).toBeUndefined();
    }
  });
});

describe("newIdError / canSubmitNewId", () => {
  test("an empty input is not an error, just not submittable", () => {
    expect(newIdError("", "jorna", t)).toBeUndefined();
    expect(canSubmitNewId("  ", "jorna")).toBe(false);
  });

  test("kebab slugs pass — including the chapter number prefix", () => {
    for (const id of ["hafenmeisterin", "alte-fischerin", "01-salzhafen", "x1"]) {
      expect(newIdError(id, "jorna", t)).toBeUndefined();
      expect(canSubmitNewId(id, "jorna")).toBe(true);
    }
  });

  test("non-kebab input is rejected before the request", () => {
    for (const id of ["Hafen", "hafen meisterin", "hafen_meisterin", "-hafen", "hafen--x", "ö"]) {
      expect(newIdError(id, "jorna", t)).toContain("Kleinbuchstaben");
      expect(canSubmitNewId(id, "jorna")).toBe(false);
    }
  });

  test("the same id is „unverändert“, reserved names are refused", () => {
    expect(newIdError("jorna", "jorna", t)).toContain("Unverändert");
    expect(canSubmitNewId(" jorna ", "jorna")).toBe(false);
    expect(newIdError("sessions", "jorna", t)).toContain("reservierte");
    expect(canSubmitNewId("npcs", "jorna")).toBe(false);
  });
});

describe("changedCountLabel", () => {
  test("singular and plural", () => {
    expect(changedCountLabel(1, t)).toBe("betrifft 1 Eintrag");
    expect(changedCountLabel(4, t)).toBe("betrifft 4 Einträge");
  });
});

describe("renamedPath", () => {
  test("the renamed file itself", () => {
    expect(renamedPath("npcs/jorna", { from: "npcs/jorna", to: "npcs/x" })).toBe(
      "npcs/x",
    );
  });

  test("a file inside a renamed chapter directory follows along", () => {
    expect(renamedPath("01-salzhafen", { from: "01-salzhafen", to: "01-salzbucht" }))
      .toBe("01-salzbucht");
    expect(
      renamedPath("01-salzhafen/hafen/ankunft-leuchtturm", {
        from: "01-salzhafen",
        to: "01-salzbucht",
      }),
    ).toBe("01-salzbucht/hafen/ankunft-leuchtturm");
  });

  test("an unrelated path stays put", () => {
    expect(renamedPath("npcs/fenn", { from: "npcs/jorna", to: "npcs/x" })).toBe(
      "npcs/fenn",
    );
  });
});

describe("renameErrorMessage", () => {
  test("409 names the blocking path", () => {
    const error = new ApiError(409, "target already exists", { path: "npcs/fenn" });
    expect(renameErrorMessage(error, t)).toBe("npcs/fenn existiert schon — andere id wählen.");
  });

  test("409 without a path is the ambiguous-id case", () => {
    expect(renameErrorMessage(new ApiError(409, "ambiguous"), t)).toContain("Mehrere Einträge");
  });

  test("400/404 and anything else stay one quiet line", () => {
    expect(renameErrorMessage(new ApiError(400, "bad id"), t)).toContain("id abgelehnt");
    expect(renameErrorMessage(new ApiError(404, "not found"), t)).toContain("Nicht gefunden");
    expect(renameErrorMessage(new ApiError(500, "boom"), t)).toContain("Server prüfen");
    expect(renameErrorMessage(new Error("offline"), t)).toContain("Server prüfen");
  });
});

describe("renameKindLabel", () => {
  test("German labels for the dialog title", () => {
    expect(renameKindLabel("npc", t)).toBe("NPC");
    expect(renameKindLabel("location", t)).toBe("Ort");
    expect(renameKindLabel("scene", t)).toBe("Szene");
    expect(renameKindLabel("chapter", t)).toBe("Kapitel");
  });
});

// --- usage summary (issue #60) ----------------------------------------------

function group(ref: UsageGroup["ref"], count: number): UsageGroup {
  return { ref, count, sites: [] };
}

function report(groups: UsageGroup[]): UsageReport {
  return {
    kind: "npc",
    id: "jorna",
    path: "npcs/jorna",
    total: groups.reduce((sum, g) => sum + g.count, 0),
    groups,
  };
}

describe("usage summary", () => {
  test("one German line per group, in the server's order", () => {
    expect(
      usageSummary(
        report([group("sceneNpcs", 3), group("npcRelations", 2), group("logEntries", 4)]),
        t,
      ),
    ).toBe("3 Szenen, 2 Beziehungen, 4 Log-Zeilen");
  });

  test("singular per group, not per report", () => {
    expect(usageGroupLabel(group("sceneNpcs", 1), t)).toBe("1 Szene");
    expect(usageGroupLabel(group("npcRelations", 1), t)).toBe("1 Beziehung");
    expect(usageGroupLabel(group("scenesPlayed", 1), t)).toBe("1 Session-Eintrag");
    expect(usageGroupLabel(group("scenesPlayed", 2), t)).toBe("2 Session-Einträge");
    expect(usageGroupLabel(group("logEntries", 1), t)).toBe("1 Log-Zeile");
    expect(usageGroupLabel(group("chapterNpcs", 1), t)).toBe("1 NPC");
    expect(usageGroupLabel(group("chapterNpcs", 3), t)).toBe("3 NPCs");
    expect(usageGroupLabel(group("chapterLocations", 1), t)).toBe("1 Ort");
    expect(usageGroupLabel(group("chapterLocations", 2), t)).toBe("2 Orte");
    expect(usageGroupLabel(group("sceneLocation", 2), t)).toBe("2 Szenen");
    expect(usageGroupLabel(group("chapterScenes", 2), t)).toBe("2 Szenen");
  });

  test("nothing references the id — the reassuring case is spelled out", () => {
    expect(usageSummary(report([]), t)).toContain("Keine Referenzen");
  });

  test("the headline counts usages, not documents", () => {
    expect(usageTotalLabel(1, t)).toBe("1 Verwendung");
    expect(usageTotalLabel(12, t)).toBe("12 Verwendungen");
  });
});
