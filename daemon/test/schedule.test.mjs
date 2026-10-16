import assert from "node:assert/strict";
import { test } from "node:test";
import { dateIn, nextRun } from "../actions/schedule.mjs";

const at = (iso) => Date.parse(iso);

test("daily and weekday schedules run at the next local time", () => {
  const monday = at("2026-10-12T10:00:00Z");
  assert.equal(new Date(nextRun({ every: "day", times: ["09:00", "18:30"] }, "UTC", monday)).toISOString(), "2026-10-12T18:30:00.000Z");
  const friday = at("2026-10-16T20:00:00Z");
  assert.equal(new Date(nextRun({ every: "weekday", times: ["09:00"] }, "UTC", friday)).toISOString(), "2026-10-19T09:00:00.000Z");
  assert.equal(new Date(nextRun({ every: "week", times: ["07:00"], day: 0 }, "UTC", friday)).toISOString(), "2026-10-18T07:00:00.000Z");
});

test("local times follow the time zone across a change of clocks", () => {
  const before = at("2026-10-24T08:00:00Z");
  assert.equal(new Date(nextRun({ every: "day", times: ["09:00"] }, "Europe/Berlin", before)).toISOString(), "2026-10-25T08:00:00.000Z");
});

test("hourly runs at its minute, and once refuses a time that has passed", () => {
  assert.equal(new Date(nextRun({ every: "hour", times: ["00:15"] }, "UTC", at("2026-10-12T10:20:00Z"))).toISOString(), "2026-10-12T11:15:00.000Z");
  assert.throws(() => nextRun({ every: "once", times: ["09:00"], date: "2020-01-01" }, "UTC", Date.now()), { status: 400 });
  assert.equal(dateIn(at("2026-10-12T23:30:00Z"), "Asia/Kolkata"), "2026-10-13");
});
