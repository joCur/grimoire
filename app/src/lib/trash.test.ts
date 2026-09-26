// The days a row in the trash has left, counted on the calendar from today.

import { describe, expect, test } from "bun:test";
import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";

import { daysUntilPurge } from "./trash";

const DELETED = new Date(2026, 8, 1, 10, 0, 0).getTime();

describe("daysUntilPurge", () => {
  test("a row that went to the trash today has the whole retention left", () => {
    expect(daysUntilPurge(DELETED, new Date(2026, 8, 1, 23, 0, 0))).toBe(TRASH_RETENTION_DAYS);
  });

  test("each calendar day takes one off, whatever the hour", () => {
    expect(daysUntilPurge(DELETED, new Date(2026, 8, 2, 0, 5, 0))).toBe(TRASH_RETENTION_DAYS - 1);
    expect(daysUntilPurge(DELETED, new Date(2026, 8, 11, 9, 0, 0))).toBe(TRASH_RETENTION_DAYS - 10);
  });

  test("on its last day and past it, a row has none left", () => {
    expect(daysUntilPurge(DELETED, new Date(2026, 9, 1, 8, 0, 0))).toBe(0);
    expect(daysUntilPurge(DELETED, new Date(2026, 9, 3, 8, 0, 0))).toBe(0);
  });
});
