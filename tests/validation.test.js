import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/constants.js";
import { normalizeSettings } from "../src/shared/validation.js";

test("returns defaults for empty input", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test("clamps invalid numeric values", () => {
  const result = normalizeSettings({
    workMinutes: -10,
    shortBreakMinutes: 999,
    reminderAutoCloseSeconds: 1,
    breakCountdownSeconds: "bad"
  });

  assert.equal(result.workMinutes, DEFAULT_SETTINGS.workMinutes);
  assert.equal(result.shortBreakMinutes, 60);
  assert.equal(result.reminderAutoCloseSeconds, 5);
  assert.equal(result.breakCountdownSeconds, DEFAULT_SETTINGS.breakCountdownSeconds);
});

test("keeps only valid snooze options", () => {
  const result = normalizeSettings({
    snoozeMinutesOptions: [0, "5", 61, 10]
  });

  assert.deepEqual(result.snoozeMinutesOptions, [5, 10]);
});
