import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.js";
import { normalizeSettings } from "../src/shared/validation.js";

test("returns defaults for empty input", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test("allows empty scheduleDays if explicitly provided", () => {
  const res = normalizeSettings({ scheduleDays: [] });
  // Now we want empty scheduleDays to fallback to DEFAULT_SETTINGS.scheduleDays (which is 1-5)
  // because an empty scheduleDays means the user didn't select any days, which is invalid.
  assert.deepEqual(res.scheduleDays, [1, 2, 3, 4, 5]);
});

test("normalizes boolean strings correctly", () => {
  assert.equal(normalizeSettings({ scheduleEnabled: "true" }).scheduleEnabled, true);
  assert.equal(normalizeSettings({ scheduleEnabled: "false" }).scheduleEnabled, false);
});

test("invalid booleans fallback to default", () => {
  assert.equal(normalizeSettings({ scheduleEnabled: "invalid" }).scheduleEnabled, false);
  assert.equal(normalizeSettings({ enabled: "invalid" }).enabled, true); // enabled default is true
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

test("supports string snooze options with Chinese commas and whitespace delimiters", () => {
  const result1 = normalizeSettings({
    snoozeMinutesOptions: "10，5， 15"
  });
  assert.deepEqual(result1.snoozeMinutesOptions, [5, 10, 15]);

  const result2 = normalizeSettings({
    snoozeMinutesOptions: "5 10 20"
  });
  assert.deepEqual(result2.snoozeMinutesOptions, [5, 10, 20]);
});

test("falls back to default snooze options when all provided options are invalid", () => {
  const result = normalizeSettings({
    snoozeMinutesOptions: [0, 999, -5]
  });

  assert.deepEqual(result.snoozeMinutesOptions, DEFAULT_SETTINGS.snoozeMinutesOptions);
});

test("validates and normalizes schedule settings", () => {
  const valid = normalizeSettings({
    scheduleEnabled: true,
    scheduleStartTime: "08:30",
    scheduleEndTime: "17:45",
    scheduleDays: [5, 1, 3, 1, 99, -1, "2"]
  });

  assert.equal(valid.scheduleEnabled, true);
  assert.equal(valid.scheduleStartTime, "08:30");
  assert.equal(valid.scheduleEndTime, "17:45");
  assert.deepEqual(valid.scheduleDays, [1, 2, 3, 5], "should filter, deduplicate, and sort days");

  const invalid = normalizeSettings({
    scheduleStartTime: "25:99",
    scheduleEndTime: "invalid",
    scheduleDays: "not-an-array"
  });

  assert.equal(invalid.scheduleStartTime, DEFAULT_SETTINGS.scheduleStartTime);
  assert.equal(invalid.scheduleEndTime, DEFAULT_SETTINGS.scheduleEndTime);
  assert.deepEqual(invalid.scheduleDays, DEFAULT_SETTINGS.scheduleDays);
});
