import { DEFAULT_SETTINGS } from "./constants.js";

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return fallback;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function normalizeSnoozeOption(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function clampIntegerToMin(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

export function normalizeSettings(input = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...input
  };

  const snoozeMinutesOptions = Array.isArray(merged.snoozeMinutesOptions)
    ? merged.snoozeMinutesOptions
        .map((value) => normalizeSnoozeOption(value, 1, 60))
        .filter((value) => value !== null)
        .slice(0, 3)
    : DEFAULT_SETTINGS.snoozeMinutesOptions;

  return {
    enabled: Boolean(merged.enabled),
    workMinutes: clampInteger(merged.workMinutes, 1, 240, DEFAULT_SETTINGS.workMinutes),
    shortBreakMinutes: clampInteger(
      merged.shortBreakMinutes,
      1,
      60,
      DEFAULT_SETTINGS.shortBreakMinutes
    ),
    longBreakMinutes: clampInteger(
      merged.longBreakMinutes,
      1,
      120,
      DEFAULT_SETTINGS.longBreakMinutes
    ),
    longBreakEvery: clampInteger(merged.longBreakEvery, 1, 12, DEFAULT_SETTINGS.longBreakEvery),
    reminderAutoCloseSeconds: clampIntegerToMin(
      merged.reminderAutoCloseSeconds,
      5,
      300,
      DEFAULT_SETTINGS.reminderAutoCloseSeconds
    ),
    breakCountdownSeconds: clampInteger(
      merged.breakCountdownSeconds,
      10,
      7200,
      DEFAULT_SETTINGS.breakCountdownSeconds
    ),
    snoozeMinutesOptions:
      snoozeMinutesOptions.length > 0 ? snoozeMinutesOptions : DEFAULT_SETTINGS.snoozeMinutesOptions,
    reminderTitle: String(merged.reminderTitle || DEFAULT_SETTINGS.reminderTitle).slice(0, 80),
    reminderBody: String(merged.reminderBody || DEFAULT_SETTINGS.reminderBody).slice(0, 200)
  };
}
