// Tests for the pure half of „Umbenennen" (issue #30): which files offer the
// action, the id rules the dialog blocks on before it ever asks the server,
// and where the reading view has to go after the cascade.

import type { EntityKind } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import {
  canSubmitNewId,
  changedCountLabel,
  newIdError,
  renameErrorMessage,
  renameKindLabel,
  renamedPath,
  renameTargetFor,
} from "@/lib/rename";

function file(path: string, kind: EntityKind, frontmatter: Record<string, unknown> = {}) {
  return { path, kind, frontmatter };
}

describe("renameTargetFor", () => {
  test("npc/location/scene use the frontmatter id", () => {
    expect(renameTargetFor(file("npcs/jorna.md", "npc", { id: "jorna" }))).toEqual({
      kind: "npc",
      oldId: "jorna",
    });
    expect(renameTargetFor(file("locations/leuchtturm.md", "location", { id: "leuchtturm" })))
      .toEqual({ kind: "location", oldId: "leuchtturm" });
    // the scene id is NOT the file name — the frontmatter wins
    expect(
      renameTargetFor(
        file("01-salzhafen/hafen/ankunft-leuchtturm.md", "scene", { id: "lighthouse-arrival" }),
      ),
    ).toEqual({ kind: "scene", oldId: "lighthouse-arrival" });
  });

  test("a missing id degrades to the file stem", () => {
    expect(renameTargetFor(file("npcs/fenn.md", "npc"))).toEqual({ kind: "npc", oldId: "fenn" });
  });

  test("a chapter is renamed by its DIRECTORY, not by _chapter.md", () => {
    expect(renameTargetFor(file("01-salzhafen/_chapter.md", "chapter", { id: "01-salzhafen" })))
      .toEqual({ kind: "chapter", oldId: "01-salzhafen" });
    // a _chapter.md one level deeper is not a chapter we can rename
    expect(renameTargetFor(file("01-salzhafen/hafen/_chapter.md", "chapter"))).toBeUndefined();
  });

  test("kinds without a renameable id offer nothing", () => {
    for (const [path, kind] of [
      ["sessions/2026-01-15.md", "session"],
      ["inbox.md", "inbox"],
      ["glossary.md", "glossary"],
      ["_campaign.md", "campaign"],
      ["weird.md", "unknown"],
    ] as Array<[string, EntityKind]>) {
      expect(renameTargetFor(file(path, kind, { id: "x" }))).toBeUndefined();
    }
  });
});

describe("newIdError / canSubmitNewId", () => {
  test("an empty input is not an error, just not submittable", () => {
    expect(newIdError("", "jorna")).toBeUndefined();
    expect(canSubmitNewId("  ", "jorna")).toBe(false);
  });

  test("kebab slugs pass — including the chapter number prefix", () => {
    for (const id of ["hafenmeisterin", "alte-fischerin", "01-salzhafen", "x1"]) {
      expect(newIdError(id, "jorna")).toBeUndefined();
      expect(canSubmitNewId(id, "jorna")).toBe(true);
    }
  });

  test("non-kebab input is rejected before the request", () => {
    for (const id of ["Hafen", "hafen meisterin", "hafen_meisterin", "-hafen", "hafen--x", "ö"]) {
      expect(newIdError(id, "jorna")).toContain("Kleinbuchstaben");
      expect(canSubmitNewId(id, "jorna")).toBe(false);
    }
  });

  test("the same id is „unverändert“, reserved names are refused", () => {
    expect(newIdError("jorna", "jorna")).toContain("Unverändert");
    expect(canSubmitNewId(" jorna ", "jorna")).toBe(false);
    expect(newIdError("sessions", "jorna")).toContain("reservierte");
    expect(canSubmitNewId("npcs", "jorna")).toBe(false);
  });
});

describe("changedCountLabel", () => {
  test("singular and plural", () => {
    expect(changedCountLabel(1)).toBe("betrifft 1 Datei");
    expect(changedCountLabel(4)).toBe("betrifft 4 Dateien");
  });
});

describe("renamedPath", () => {
  test("the renamed file itself", () => {
    expect(renamedPath("npcs/jorna.md", { from: "npcs/jorna.md", to: "npcs/x.md" })).toBe(
      "npcs/x.md",
    );
  });

  test("a file inside a renamed chapter directory follows along", () => {
    expect(renamedPath("01-salzhafen/_chapter.md", { from: "01-salzhafen", to: "01-salzbucht" }))
      .toBe("01-salzbucht/_chapter.md");
    expect(
      renamedPath("01-salzhafen/hafen/ankunft-leuchtturm.md", {
        from: "01-salzhafen",
        to: "01-salzbucht",
      }),
    ).toBe("01-salzbucht/hafen/ankunft-leuchtturm.md");
  });

  test("an unrelated path stays put", () => {
    expect(renamedPath("npcs/fenn.md", { from: "npcs/jorna.md", to: "npcs/x.md" })).toBe(
      "npcs/fenn.md",
    );
  });
});

describe("renameErrorMessage", () => {
  test("409 names the blocking path", () => {
    const error = new ApiError(409, "target already exists", { path: "npcs/fenn.md" });
    expect(renameErrorMessage(error)).toBe("npcs/fenn.md existiert schon — andere id wählen.");
  });

  test("409 without a path is the ambiguous-id case", () => {
    expect(renameErrorMessage(new ApiError(409, "ambiguous"))).toContain("Mehrere Dateien");
  });

  test("400/404 and anything else stay one quiet line", () => {
    expect(renameErrorMessage(new ApiError(400, "bad id"))).toContain("id abgelehnt");
    expect(renameErrorMessage(new ApiError(404, "not found"))).toContain("Nicht gefunden");
    expect(renameErrorMessage(new ApiError(500, "boom"))).toContain("Server prüfen");
    expect(renameErrorMessage(new Error("offline"))).toContain("Server prüfen");
  });
});

describe("renameKindLabel", () => {
  test("German labels for the dialog title", () => {
    expect(renameKindLabel("npc")).toBe("NPC");
    expect(renameKindLabel("location")).toBe("Ort");
    expect(renameKindLabel("scene")).toBe("Szene");
    expect(renameKindLabel("chapter")).toBe("Kapitel");
  });
});
