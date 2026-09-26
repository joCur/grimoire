// HTTP helpers shared by the route modules: reading a request body and
// checking the fields several routes have in common.

import type { Context } from "hono";
import { ApiError } from "../api-error";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Parse the JSON body; must be an object with no keys outside `allowed`.
 * `null` leaves the keys to the kind's schema, which names an unknown one
 * itself (a location's PATCH).
 */
export async function jsonBody(
  c: Context,
  allowed: string[] | null,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "request body must be valid JSON");
  }
  if (!isPlainObject(body)) throw new ApiError(400, "request body must be a JSON object");
  if (allowed === null) return body;
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ApiError(400, `unknown body key: ${key}`);
  }
  return body;
}

/**
 * The `rev` of a guarded write. A MISSING rev has to be a 400 and never a
 * default, because a defaulted guard token is no guard at all (decisions/writes).
 */
export function requireRev(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(400, "rev must be a number");
  }
  return value;
}

/**
 * Normalize free text destined for a single markdown list line: trim and
 * collapse any internal newline (plus surrounding spaces) to one space.
 * Returns undefined for non-strings and for text that is empty after
 * trimming.
 */
export function normalizeLineText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = v.replace(/\s*\r?\n\s*/g, " ").trim();
  return text === "" ? undefined : text;
}

/** The one required free-text field of a create body: trimmed, non-empty. */
export function requiredText(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new ApiError(400, `${what} must be a non-empty string`);
  }
  return v.trim();
}

/** An optional free-text field: undefined when absent, null or blank. */
export function optionalText(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ApiError(400, `${what} must be a string`);
  return v.trim() === "" ? undefined : v.trim();
}
