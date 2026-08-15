import { DEFAULT_SETTINGS } from "./constants.js";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toInteger(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = toInteger(value);
  if (parsed === null) {
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
  const parsed = toInteger(value);
  if (parsed === null || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

export function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeTimeString(value, fallback) {
  if (typeof value === "string" && TIME_REGEX.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

function normalizeScheduleDays(days, fallback = [1, 2, 3, 4, 5]) {
  if (!Array.isArray(days) || days.length === 0) {
    return fallback;
  }

  const validDays = days
    .map(toInteger)
    .filter((item) => item !== null && item >= 0 && item <= 6);

  if (validDays.length === 0) {
    return fallback;
  }

  const deduplicated = Array.from(new Set(validDays)).sort((a, b) => a - b);
  return deduplicated;
}

function parseRawSnoozeOptions(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === "string") {
    return input.split(/[,，\s]+/).filter(Boolean);
  }
  return [];
}

export function normalizeSettings(input = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...input
  };

  const rawSnooze = parseRawSnoozeOptions(merged.snoozeMinutesOptions);

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
    enabled: normalizeBoolean(merged.enabled, DEFAULT_SETTINGS.enabled),
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
    scheduleEnabled: normalizeBoolean(merged.scheduleEnabled, DEFAULT_SETTINGS.scheduleEnabled),
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
