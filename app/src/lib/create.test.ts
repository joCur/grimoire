// The pure half of the create dialogs: the derived id, and how a failed POST
// becomes ONE sentence in the UI language plus, on a collision, one actionable
// proposal.
//
// The sentence is built from the server's error CODE through the catalog, so
// the expectations are catalog entries formatted with the body's parameters —
// with the body's English `error` text as the documented fallback for an
// unknown code.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { canCreate, createConflict, createErrorMessage, derivedId } from "@/lib/create";
import { translator } from "@/i18n/format";

// The language the assertions below run in: the helpers take the translator as
// an argument, so a test says so explicitly instead of leaning on a default.
const t = translator("de");
const en = translator("en");

const conflictError = (details: Record<string, unknown>) =>
  new ApiError(409, "already exists", {
    error: 'npc "holm" already exists — suggestion: "holm-2"',
    ...details,
  });

describe("derivedId", () => {
  test("shows the id a name will produce", () => {
    expect(derivedId("Old Fisherwoman")).toBe("old-fisherwoman");
    expect(derivedId("Arrival at the Lighthouse")).toBe("arrival-at-the-lighthouse");
  });

  test("yields nothing where a name carries no id at all", () => {
    expect(derivedId("")).toBe("");
    expect(derivedId("!!!")).toBe("");
  });
});

describe("canCreate", () => {
  test("a name has to yield an id", () => {
    expect(canCreate("Harbor")).toBe(true);
    expect(canCreate("")).toBe(false);
    expect(canCreate("   ")).toBe(false);
    expect(canCreate("???")).toBe(false);
  });
});

describe("createConflict", () => {
  test("reads the slug_taken body", () => {
    const conflict = createConflict(
      conflictError({ code: "slug_taken", kind: "npc", id: "holm", suggestion: "holm-2" }),
    );
    expect(conflict).toEqual({ id: "holm", suggestion: "holm-2" });
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
  test("the code's sentence wins for 409 and 400 — it names the value", () => {
    expect(
      createErrorMessage(
        conflictError({ code: "slug_taken", kind: "npc", id: "holm", suggestion: "holm-2" }),
        t,
      ),
    ).toBe(t("server.slug_taken", { kind: t("server.kind.npc"), id: "holm", suggestion: "holm-2" }));
    expect(
      createErrorMessage(
        new ApiError(400, "x", {
          code: "slug_empty",
          kind: "npc",
          field: "name",
          error: "the name yields no id — use letters or digits",
        }),
        t,
      ),
    ).toBe(t("server.slug_empty", { field: t("server.field.name") }));
  });

  test("a body with no kind names the generic subject in every language", () => {
    // The generic kind is its own catalog entry carrying its article, so the
    // sentence stays grammatical without a kind.
    const body = { code: "slug_taken", id: "holm", suggestion: "holm-2" };
    for (const tr of [t, en]) {
      expect(createErrorMessage(conflictError(body), tr)).toBe(
        tr("server.slug_taken", { kind: tr("server.kind.fallback"), id: "holm", suggestion: "holm-2" }),
      );
    }
  });

  test("an English translation is really the English one", () => {
    expect(
      createErrorMessage(
        conflictError({ code: "slug_taken", kind: "npc", id: "holm", suggestion: "holm-2" }),
        en,
      ),
    ).toBe(en("server.slug_taken", { kind: en("server.kind.npc"), id: "holm", suggestion: "holm-2" }));
    expect(en("server.slug_taken", { kind: "x", id: "y", suggestion: "z" })).not.toBe(
      t("server.slug_taken", { kind: "x", id: "y", suggestion: "z" }),
    );
  });

  test("an unknown code degrades to the body's English text, never to nothing", () => {
    expect(
      createErrorMessage(
        new ApiError(409, "x", { code: "from_a_newer_server", error: "something is in the way" }),
        t,
      ),
    ).toBe("something is in the way");
    // …and a code whose body is missing its parameters does the same.
    expect(
      createErrorMessage(conflictError({ code: "slug_taken", kind: "npc" }), t),
    ).toBe('npc "holm" already exists — suggestion: "holm-2"');
  });

  test("everything else degrades to one honest sentence", () => {
    expect(createErrorMessage(new ApiError(500, "x", { error: "internal server error" }), t)).toBe(
      t("create.failed"),
    );
    expect(createErrorMessage(new ApiError(404, "x", {}), t)).toBe(t("create.failed"));
    expect(createErrorMessage(new Error("offline"), t)).toBe(t("create.failed"));
  });
});
