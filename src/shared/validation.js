import { DEFAULT_SETTINGS } from "./constants.js";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clampInteger(value, min, max, fallback) {
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

function normalizeSnoozeOption(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function normalizeTimeString(value, fallback) {
  if (typeof value === "string" && TIME_REGEX.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

function normalizeScheduleDays(days, fallback = [1, 2, 3, 4, 5]) {
  if (!Array.isArray(days)) {
    return fallback;
  }

  const validDays = days
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);

  const deduplicated = Array.from(new Set(validDays)).sort((a, b) => a - b);
  return deduplicated.length > 0 ? deduplicated : fallback;
}

export function normalizeSettings(input = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...input
  };

  const rawSnooze = Array.isArray(merged.snoozeMinutesOptions)
    ? merged.snoozeMinutesOptions
    : [];

  const validSnooze = rawSnooze
    .map((value) => normalizeSnoozeOption(value, 1, 60))
    .filter((value) => value !== null);

  const deduplicatedSortedSnooze = Array.from(new Set(validSnooze))
    .sort((a, b) => a - b)
    .slice(0, 3);

  const snoozeMinutesOptions =
    deduplicatedSortedSnooze.length > 0
      ? deduplicatedSortedSnooze
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
    reminderAutoCloseSeconds: clampInteger(
      merged.reminderAutoCloseSeconds,
      5,
      300,
      DEFAULT_SETTINGS.reminderAutoCloseSeconds
    ),
    snoozeMinutesOptions,
    reminderTitle: String(merged.reminderTitle || DEFAULT_SETTINGS.reminderTitle).slice(0, 80),
    reminderBody: String(merged.reminderBody || DEFAULT_SETTINGS.reminderBody).slice(0, 200),
    scheduleEnabled: Boolean(merged.scheduleEnabled),
    scheduleStartTime: normalizeTimeString(
      merged.scheduleStartTime,
      DEFAULT_SETTINGS.scheduleStartTime
    ),
    scheduleEndTime: normalizeTimeString(
      merged.scheduleEndTime,
      DEFAULT_SETTINGS.scheduleEndTime
    ),
    scheduleDays: normalizeScheduleDays(
      merged.scheduleDays,
      DEFAULT_SETTINGS.scheduleDays
    )
  };
}
