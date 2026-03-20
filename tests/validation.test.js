import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/constants.js";
import { normalizeSettings } from "../src/shared/validation.js";

describe("settings validation", () => {
  it("returns defaults for empty input", () => {
    expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps invalid numeric values", () => {
    const result = normalizeSettings({
      workMinutes: -10,
      shortBreakMinutes: 999,
      reminderAutoCloseSeconds: 1,
      breakCountdownSeconds: "bad"
    });

    expect(result.workMinutes).toBe(DEFAULT_SETTINGS.workMinutes);
    expect(result.shortBreakMinutes).toBe(60);
    expect(result.reminderAutoCloseSeconds).toBe(5);
    expect(result.breakCountdownSeconds).toBe(DEFAULT_SETTINGS.breakCountdownSeconds);
  });

  it("keeps only valid snooze options", () => {
    const result = normalizeSettings({
      snoozeMinutesOptions: [0, "5", 61, 10]
    });

    expect(result.snoozeMinutesOptions).toEqual([5, 10]);
  });
});
