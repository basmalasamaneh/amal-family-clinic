import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesWindow } from "../src/waitlist/matching";
import { formatInTimeZone } from "date-fns-tz";

const entry = { weekdays: [0, 1, 2, 3, 4, 5, 6], window_start: "08:00", window_end: "10:00" };
test("Hebron local weekday/window contains the entire instant interval, not UTC weekday/offset", () => {
  assert(matchesWindow(entry, new Date("2026-01-05T06:00:00Z"), new Date("2026-01-05T08:00:00Z")));
  assert(matchesWindow(entry, new Date("2026-07-05T05:00:00Z"), new Date("2026-07-05T07:00:00Z")));
  assert(!matchesWindow(entry, new Date("2026-07-05T04:59:00Z"), new Date("2026-07-05T05:30:00Z")));
  assert(!matchesWindow(entry, new Date("2026-07-05T06:30:00Z"), new Date("2026-07-05T07:01:00Z")));
  assert(!matchesWindow({ ...entry, weekdays: [1] }, new Date("2026-07-05T05:00:00Z"), new Date("2026-07-05T05:30:00Z")));
  assert(!matchesWindow(entry, new Date("invalid"), new Date()));
});
test("DST gap/fold matching inspects all wall-clock minutes, including repeated hours", () => {
  // Locate actual Hebron timezone transitions from installed IANA data rather
  // than assuming an offset or a political DST date.
  const transitions: number[] = [];
  const start = Date.parse("2026-01-01T00:00:00Z");
  let prior = formatInTimeZone(start, "Asia/Hebron", "xxx");
  for (let at = start + 3600000; at < Date.parse("2027-01-01T00:00:00Z"); at += 3600000) {
    const offset = formatInTimeZone(at, "Asia/Hebron", "xxx");
    if (offset !== prior) transitions.push(at);
    prior = offset;
  }
  assert.equal(transitions.length, 2);
  const allDay = { ...entry, window_start: "00:00", window_end: "23:59" };
  for (const at of transitions) {
    assert(matchesWindow(allDay, new Date(at - 1800000), new Date(at + 1800000)));
    const startClock = formatInTimeZone(at - 1800000, "Asia/Hebron", "HH:mm");
    const endClock = formatInTimeZone(at + 1800000, "Asia/Hebron", "HH:mm");
    if (startClock < endClock) {
      assert(!matchesWindow({ ...allDay, window_end: startClock }, new Date(at - 1800000), new Date(at + 1800000)));
    } else {
      assert(!matchesWindow({ ...allDay, window_start: startClock }, new Date(at - 1800000), new Date(at + 1800000)));
    }
  }
});
