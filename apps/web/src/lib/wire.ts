import type { ClientFrame } from "../proto/ClientFrame";
import type { ServerFrame } from "../proto/ServerFrame";

/**
 * The host sends `i64` fields as JSON numbers, but the generated types call them `bigint`.
 * We turn the known fields into `bigint` on the way in and back into numbers on the way out,
 * so the rest of the app can trust the generated types.
 */
const BIGINT_KEYS = new Set([
  "seq",
  "last_seq",
  "after_seq",
  "sub_seq",
  "tokens_in",
  "tokens_out",
  "cost_micros",
]);

function revive(this: unknown, key: string, value: unknown): unknown {
  if (BIGINT_KEYS.has(key) && (typeof value === "number" || typeof value === "string")) {
    return BigInt(value);
  }
  return value;
}

function replace(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

export function decode<T = ServerFrame>(text: string): T {
  return JSON.parse(text, revive) as T;
}

export function encode(frame: ClientFrame | unknown): string {
  return JSON.stringify(frame, replace);
}

/** Turns a plain JSON value (already parsed) into the typed shape. */
export function revivePlain<T>(value: unknown): T {
  return decode<T>(encode(value));
}
