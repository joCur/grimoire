// The pure half of the create dialogs (issue #56): the address preview, and
// how a failed POST becomes a German sentence plus, on a collision, one
// actionable proposal.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import {
  canCreate,
  createConflict,
  createErrorMessage,
  derivedAddress,
  derivedId,
} from "@/lib/create";

const conflictError = (details: Record<string, unknown>) =>
  new ApiError(409, "gibt es schon", { error: "NPC „holm\" gibt es schon", ...details });

describe("derivedId / derivedAddress", () => {
  test("shows the id a name will produce", () => {
    expect(derivedId("Alte Fischerin")).toBe("alte-fischerin");
    expect(derivedAddress("Alte Fischerin", "npcs/")).toBe("npcs/alte-fischerin");
    expect(derivedAddress("Ankunft am Leuchtturm", "01-salzhafen/")).toBe(
      "01-salzhafen/ankunft-am-leuchtturm",
    );
  });

  test("stays silent while there is no id — never half an address", () => {
    expect(derivedAddress("", "npcs/")).toBeUndefined();
    expect(derivedAddress("!!!", "npcs/")).toBeUndefined();
  });
});

describe("canCreate", () => {
  test("a name has to yield an id", () => {
    expect(canCreate("Hafen")).toBe(true);
    expect(canCreate("")).toBe(false);
    expect(canCreate("   ")).toBe(false);
    expect(canCreate("???")).toBe(false);
  });
});

describe("createConflict", () => {
  test("reads the slug_taken body", () => {
    const conflict = createConflict(
      conflictError({ code: "slug_taken", id: "holm", suggestion: "holm-2", path: "npcs/holm" }),
    );
    expect(conflict).toEqual({ id: "holm", suggestion: "holm-2", path: "npcs/holm" });
  });

  test("a missing path degrades to an empty one rather than throwing", () => {
    const conflict = createConflict(
      conflictError({ code: "slug_taken", id: "holm", suggestion: "holm-2" }),
    );
    expect(conflict?.path).toBe("");
  });

  test("no proposal, no button", () => {
    // A 409 without a usable suggestion must not produce a click that sends
    // nothing — the dialog then only shows the message.
    expect(
      createConflict(conflictError({ code: "slug_taken", id: "holm", suggestion: "" })),
    ).toBeUndefined();
    expect(createConflict(conflictError({ code: "slug_taken", id: "holm" }))).toBeUndefined();
  });

  test("other 409s and other errors are not collisions", () => {
    expect(createConflict(conflictError({ code: "session_running" }))).toBeUndefined();
    expect(createConflict(new ApiError(400, "nope", { error: "nope" }))).toBeUndefined();
    expect(createConflict(new Error("offline"))).toBeUndefined();
  });
});

describe("createErrorMessage", () => {
  test("the server's German sentence wins for 409 and 400 — it names the value", () => {
    expect(
      createErrorMessage(
        conflictError({ code: "slug_taken", id: "holm", suggestion: "holm-2" }),
      ),
    ).toBe("NPC „holm\" gibt es schon");
    expect(
      createErrorMessage(
        new ApiError(400, "x", { error: "Der Name ergibt keine id — bitte Buchstaben verwenden" }),
      ),
    ).toBe("Der Name ergibt keine id — bitte Buchstaben verwenden");
  });

  test("everything else degrades to one honest sentence", () => {
    expect(createErrorMessage(new ApiError(500, "x", { error: "internal server error" }))).toBe(
      "Nicht angelegt — Server prüfen.",
    );
    expect(createErrorMessage(new ApiError(404, "x", {}))).toBe("Nicht angelegt — Server prüfen.");
    expect(createErrorMessage(new Error("offline"))).toBe("Nicht angelegt — Server prüfen.");
  });
});
