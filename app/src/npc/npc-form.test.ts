// The rules of the npc's form: what it starts with, the write that decides
// what is sent at all, the representation a cleared field is written in, and
// what blocks a save. All pure — the write itself is the npc's editing
// session (./use-npc-edit.ts).

import type { NpcProposal } from "@grimoire/shared/npc";
import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";

import {
  canSubmitNpcForm,
  npcFormChange,
  npcFormDirty,
  npcFormIssues,
  npcFormValues,
  npcProposalChange,
  type NpcFormValues,
} from "./npc-form";

const t = translator("de");

/** The fixture npc „Fenn" — its quickstats arrive as numbers. */
const FENN: NpcProposal = {
  id: "fenn",
  name: "Fenn",
  role: "Anführer der Schmuggler in der Nordbucht",
  chapter: "01-salzhafen",
  status: "alive",
  statblock: "Roll20: Fenn",
  quickstats: { wis: 2, insight: 2, "passive-perception": 13 },
  voice: "leise, höflich",
  appearance: "salzverkrustete Lederjacke",
  body: "",
};

const initial = npcFormValues(FENN);

/** The form with single fields overridden. */
const edited = (changes: Partial<NpcFormValues>): NpcFormValues => ({ ...initial, ...changes });

describe("npcFormValues", () => {
  test("quickstats become editable key/value rows, numbers as their text", () => {
    expect(initial.quickstats).toEqual([
      { key: "wis", value: "2" },
      { key: "insight", value: "2" },
      { key: "passive-perception", value: "13" },
    ]);
  });

  test("a field the npc does not hold is an empty field", () => {
    expect(initial.motivation).toBe("");
    expect(npcFormValues({ id: "x", name: "X", status: "unknown", body: "" })).toEqual({
      name: "X",
      role: "",
      chapter: "",
      status: "unknown",
      statblock: "",
      quickstats: [],
      voice: "",
      appearance: "",
      motivation: "",
    });
  });
});

describe("npcFormChange", () => {
  test("an untouched form writes nothing at all", () => {
    expect(npcFormChange(initial, initial)).toEqual({});
    expect(npcFormChange(initial, { ...initial })).toEqual({});
  });

  test("only the changed field is sent — everything else survives stored", () => {
    expect(npcFormChange(initial, edited({ status: "dead" }))).toEqual({ status: "dead" });
    expect(npcFormChange(initial, edited({ role: "Kapitän" }))).toEqual({ role: "Kapitän" });
  });

  test("whitespace around a value is not a change", () => {
    expect(npcFormChange(initial, edited({ name: "  Fenn  ", voice: "leise, höflich " }))).toEqual({});
  });

  test("clearing a field CLEARS the value — text and quickstats alike", () => {
    expect(npcFormChange(initial, edited({ voice: "   ", quickstats: [] }))).toEqual({
      voice: null,
      quickstats: null,
    });
  });

  test("an npc may sit outside every chapter — clearing it is a plain write", () => {
    const cleared = edited({ chapter: "" });
    expect(npcFormChange(initial, cleared)).toEqual({ chapter: null });
    expect(npcFormIssues(cleared, t)).toEqual({});
  });

  test("a blank name is never written — an npc cannot lose it", () => {
    expect(npcFormChange(initial, edited({ name: "  " }))).toEqual({});
    expect(canSubmitNpcForm(edited({ name: "" }), t)).toBe(false);
    expect(canSubmitNpcForm(initial, t)).toBe(true);
  });

  test("quickstats keep their types: numbers stay numbers, a typed +2 stays text", () => {
    const change = npcFormChange(
      initial,
      edited({
        quickstats: [
          { key: "wis", value: "3" },
          { key: "insight", value: "+2" },
          // A row that cannot be written (no name). It is not IN the write —
          // and it never gets there, because the issue blocks the save while
          // it stands (see „unfinished quickstat rows“ below).
          { key: "", value: "wird nicht geschrieben" },
        ],
      }),
    );
    expect(change).toEqual({ quickstats: { wis: 3, insight: "+2" } });
  });

  test("a quickstat whose VALUE was cleared loses its key — never `key: ''`", () => {
    const change = npcFormChange(
      initial,
      edited({
        quickstats: [
          { key: "wis", value: "2" },
          { key: "insight", value: "  " },
          { key: "passive-perception", value: "13" },
        ],
      }),
    );
    expect(change).toEqual({ quickstats: { wis: 2, "passive-perception": 13 } });
  });

  test("clearing every quickstat value clears the whole set", () => {
    const change = npcFormChange(
      initial,
      edited({
        quickstats: [
          { key: "wis", value: "" },
          { key: "insight", value: "" },
          { key: "passive-perception", value: "" },
        ],
      }),
    );
    expect(change).toEqual({ quickstats: null });
  });
});

describe("unfinished quickstat rows block the save", () => {
  const withStats = (quickstats: NpcFormValues["quickstats"]) => edited({ quickstats });

  test("the npc's own rows are fine — nothing to complain about", () => {
    expect(npcFormIssues(initial, t)).toEqual({});
    // An empty row (the „Zeile hinzufügen“ state) and a name whose value was
    // cleared (= delete this key) are both legitimate.
    expect(
      npcFormIssues(
        withStats([
          { key: "insight", value: "2" },
          { key: "wis", value: "" },
          { key: "", value: "" },
        ]),
        t,
      ),
    ).toEqual({});
  });

  test("a value without a name is named out loud instead of being dropped", () => {
    const values = withStats([
      { key: "insight", value: "2" },
      { key: "  ", value: "+3" },
    ]);
    expect(npcFormIssues(values, t).quickstats).toBe(
      "Zeile ohne Namen — Name ergänzen oder Zeile entfernen.",
    );
    expect(canSubmitNpcForm(values, t)).toBe(false);
  });

  test("the same name twice is refused — the set would swallow the first value", () => {
    const values = withStats([
      { key: "insight", value: "2" },
      { key: "insight", value: "3" },
    ]);
    expect(npcFormIssues(values, t).quickstats).toBe(
      'Name „insight“ doppelt — jeder Name darf nur einmal vorkommen.',
    );
  });
});

describe("npcFormDirty", () => {
  test("an untouched form has nothing to discard, whitespace neither", () => {
    expect(npcFormDirty(initial, initial, t)).toBe(false);
    expect(npcFormDirty(initial, edited({ name: "  Fenn  " }), t)).toBe(false);
  });

  test("a changed field is work — and so is an unfinished quickstat row", () => {
    expect(npcFormDirty(initial, edited({ status: "dead" }), t)).toBe(true);
    // A blank name writes nothing, and still is work that Esc must not lose.
    expect(npcFormDirty(initial, edited({ name: "" }), t)).toBe(true);
    // The invalid row produces no write at all, so the guard has to ask the
    // issues as well — otherwise Esc would throw it away silently.
    const nameless = edited({ quickstats: [...initial.quickstats, { key: "", value: "+1" }] });
    expect(npcFormChange(initial, nameless)).toEqual({});
    expect(npcFormDirty(initial, nameless, t)).toBe(true);
  });
});

describe("npcProposalChange", () => {
  test("the form of a proposed npc becomes its change: every field named", () => {
    const values = npcFormValues({
      id: "grella",
      name: "Grella",
      status: "alive",
      quickstats: { insight: "+2" },
      body: "",
    });
    expect(npcProposalChange(values)).toEqual({
      name: "Grella",
      role: null,
      chapter: null,
      status: "alive",
      statblock: null,
      quickstats: { insight: "+2" },
      voice: null,
      appearance: null,
      motivation: null,
    });
  });

  test("a blank name is not named — the proposal keeps its own", () => {
    const values = { ...npcFormValues({ id: "g", name: "Grella", status: "alive", body: "" }), name: " " };
    expect(npcProposalChange(values)).not.toHaveProperty("name");
    expect(npcProposalChange(values).status).toBe("alive");
  });
});
