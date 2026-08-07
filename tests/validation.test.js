import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.js";
import { normalizeSettings } from "../src/shared/validation.js";

test("returns defaults for empty input", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test("clamps numeric values to min and max boundaries", () => {
  const result = normalizeSettings({
    workMinutes: -10,
    shortBreakMinutes: 999,
    longBreakMinutes: 0,
    longBreakEvery: 50,
    reminderAutoCloseSeconds: 1
  });

  assert.equal(result.workMinutes, 1, "workMinutes should clamp to min 1");
  assert.equal(result.shortBreakMinutes, 60, "shortBreakMinutes should clamp to max 60");
  assert.equal(result.longBreakMinutes, 1, "longBreakMinutes should clamp to min 1");
  assert.equal(result.longBreakEvery, 12, "longBreakEvery should clamp to max 12");
  assert.equal(result.reminderAutoCloseSeconds, 5, "reminderAutoCloseSeconds should clamp to min 5");
});

test("falls back to default when input is NaN or invalid", () => {
  const result = normalizeSettings({
    workMinutes: "invalid",
    shortBreakMinutes: null,
    reminderTitle: undefined
  });

  assert.equal(result.workMinutes, DEFAULT_SETTINGS.workMinutes);
  assert.equal(result.shortBreakMinutes, DEFAULT_SETTINGS.shortBreakMinutes);
  assert.equal(result.reminderTitle, DEFAULT_SETTINGS.reminderTitle);
});

test("deduplicates, sorts, and filters snooze options", () => {
  const result = normalizeSettings({
    snoozeMinutesOptions: [10, 5, 5, 0, 65, "15", 30]
  });

  // 0 and 65 are out of bounds (1-60). 5 is duplicate. Sorted: [5, 10, 15], sliced to max 3.
  assert.deepEqual(result.snoozeMinutesOptions, [5, 10, 15]);
});

test("falls back to default snooze options when all provided options are invalid", () => {
  const result = normalizeSettings({
    snoozeMinutesOptions: [0, 999, -5]
  });

  assert.deepEqual(result.snoozeMinutesOptions, DEFAULT_SETTINGS.snoozeMinutesOptions);
});
