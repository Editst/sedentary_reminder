import assert from "node:assert/strict";
import test from "node:test";
import { MODES } from "../src/shared/constants.js";
import {
  applySnooze,
  createInitialState,
  createNextBreakState,
  createNextWorkState,
  formatDurationMs,
  formatSeconds,
  getNextScheduleStartTime,
  isSessionDue,
  isWithinSchedule,
  parseTimeToMinutes
} from "../src/shared/timer_engine.js";

const settings = {
  workMinutes: 45,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4
};

test("creates an initial work session", () => {
  const now = 1000;
  const state = createInitialState(now, settings);
  assert.equal(state.mode, MODES.work);
  assert.equal(state.currentSessionEnd, now + 45 * 60 * 1000);
});

test("switches to a short break before the threshold", () => {
  const state = createNextBreakState(
    {
      mode: MODES.work,
      cycleCount: 0
    },
    settings,
    1000
  );

  assert.equal(state.mode, MODES.shortBreak);
  assert.equal(state.cycleCount, 1);
});

test("switches to a long break at the threshold", () => {
  const state = createNextBreakState(
    {
      mode: MODES.work,
      cycleCount: 3
    },
    settings,
    1000
  );

  assert.equal(state.mode, MODES.longBreak);
  assert.equal(state.cycleCount, 0);
});

test("returns defaults for empty input", () => {
  const s = createNextBreakState({ cycleCount: 0 }, { shortBreakMinutes: 5, longBreakEvery: 4 }, 1000);
  assert.equal(s.mode, MODES.shortBreak);
});

test("parseTimeToMinutes handles double invalid gracefully", () => {
  // Should return 0 instead of throwing stack overflow
  const res = parseTimeToMinutes("invalid", "invalid");
  assert.equal(res, 0, "Double invalid should return 0");
});

test("isWithinSchedule rejects empty scheduleDays defensively", () => {
  const res = isWithinSchedule({ scheduleEnabled: true, scheduleDays: [], scheduleStartTime: "00:00", scheduleEndTime: "23:59" }, new Date("2023-01-01T12:00:00Z").getTime());
  assert.equal(res, false, "Empty scheduleDays should result in not in schedule");
});

test("returns to work from a break", () => {
  const state = createNextWorkState(
    {
      mode: MODES.shortBreak,
      cycleCount: 1
    },
    settings,
    1000
  );

  assert.equal(state.mode, MODES.work);
  assert.equal(state.currentSessionEnd, 1000 + 45 * 60 * 1000);
});

test("respects a snoozed reminder target", () => {
  const state = applySnooze(
    {
      mode: MODES.work,
      currentSessionEnd: 1000,
      snoozedUntil: 0
    },
    5,
    2000
  );

  assert.equal(isSessionDue(state, 2001), false);
  assert.equal(isSessionDue(state, 2000 + 5 * 60 * 1000), true);
});

test("isWithinSchedule: same-day work window", () => {
  const scheduleSettings = {
    scheduleEnabled: true,
    scheduleStartTime: "09:00",
    scheduleEndTime: "18:00",
    scheduleDays: [1, 2, 3, 4, 5] // Monday - Friday
  };

  // 2026-08-07 is Friday (day = 5)
  const friday10am = new Date(2026, 7, 7, 10, 0, 0).getTime();
  const friday6pm = new Date(2026, 7, 7, 18, 0, 0).getTime();
  const friday7pm = new Date(2026, 7, 7, 19, 0, 0).getTime();

  // 2026-08-08 is Saturday (day = 6)
  const saturday10am = new Date(2026, 7, 8, 10, 0, 0).getTime();

  assert.equal(isWithinSchedule(scheduleSettings, friday10am), true, "10:00 on Friday is in schedule");
  assert.equal(isWithinSchedule(scheduleSettings, friday6pm), false, "18:00 on Friday is boundary end (out)");
  assert.equal(isWithinSchedule(scheduleSettings, friday7pm), false, "19:00 on Friday is out of schedule");
  assert.equal(isWithinSchedule(scheduleSettings, saturday10am), false, "Saturday is out of schedule");

  // When schedule is disabled, always true
  assert.equal(isWithinSchedule({ ...scheduleSettings, scheduleEnabled: false }, saturday10am), true);
});

test("isWithinSchedule: cross-midnight overnight window", () => {
  const overnightSettings = {
    scheduleEnabled: true,
    scheduleStartTime: "22:00",
    scheduleEndTime: "06:00",
    scheduleDays: [1, 2, 3, 4, 5] // Mon-Fri nights
  };

  // Friday night at 23:00 (day = 5)
  const friday23 = new Date(2026, 7, 7, 23, 0, 0).getTime();
  // Saturday morning at 03:00 (day = 6, started Friday night)
  const saturday03 = new Date(2026, 7, 8, 3, 0, 0).getTime();
  // Saturday morning at 07:00 (out)
  const saturday07 = new Date(2026, 7, 8, 7, 0, 0).getTime();
  // Sunday night at 23:00 (day = 0, Sunday not in scheduleDays)
  const sunday23 = new Date(2026, 7, 9, 23, 0, 0).getTime();

  assert.equal(isWithinSchedule(overnightSettings, friday23), true, "Fri 23:00 is within schedule");
  assert.equal(isWithinSchedule(overnightSettings, saturday03), true, "Sat 03:00 (Fri night) is within schedule");
  assert.equal(isWithinSchedule(overnightSettings, saturday07), false, "Sat 07:00 is outside schedule");
  assert.equal(isWithinSchedule(overnightSettings, sunday23), false, "Sun 23:00 is outside schedule");
});

test("getNextScheduleStartTime: accurately calculates next active window start", () => {
  const scheduleSettings = {
    scheduleEnabled: true,
    scheduleStartTime: "09:00",
    scheduleEndTime: "18:00",
    scheduleDays: [1, 2, 3, 4, 5] // Monday - Friday
  };

  // Friday 19:00 (after work) -> next start is Monday 09:00 (2026-08-10 09:00)
  const friday19 = new Date(2026, 7, 7, 19, 0, 0).getTime();
  const nextStart = getNextScheduleStartTime(scheduleSettings, friday19);
  const nextDate = new Date(nextStart);

  assert.equal(nextDate.getDay(), 1, "Next start day should be Monday");
  assert.equal(nextDate.getHours(), 9, "Next start hour should be 9");
  assert.equal(nextDate.getMinutes(), 0, "Next start minute should be 0");
});

test("formatDurationMs: formats ms into MM:SS or HH:MM:SS", () => {
  assert.equal(formatDurationMs(0), "00:00");
  assert.equal(formatDurationMs(5000), "00:05");
  assert.equal(formatDurationMs(65000), "01:05");
  assert.equal(formatDurationMs(3600 * 1000), "1:00:00");
  assert.equal(formatDurationMs(3665 * 1000), "1:01:05");
  assert.equal(formatDurationMs(-500), "00:00");
  assert.equal(formatDurationMs(NaN), "00:00");
});

test("formatSeconds: formats seconds into MM:SS", () => {
  assert.equal(formatSeconds(0), "00:00");
  assert.equal(formatSeconds(30), "00:30");
  assert.equal(formatSeconds(90), "01:30");
  assert.equal(formatSeconds(-10), "00:00");
  assert.equal(formatSeconds(NaN), "00:00");
});

test("createNextWorkState can optionally increment cycleCount", () => {
  const base = { cycleCount: 1 };
  const s1 = createNextWorkState(base, { workMinutes: 45 }, 1000);
  assert.equal(s1.cycleCount, 1, "default is not to increment");

  const s2 = createNextWorkState(base, { workMinutes: 45 }, 1000, { countCycle: true });
  assert.equal(s2.cycleCount, 2, "increments when countCycle is true");
});
