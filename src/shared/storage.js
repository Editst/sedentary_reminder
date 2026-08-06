import { DEFAULT_SETTINGS, DEFAULT_STATE, MODES, STORAGE_KEYS } from "./constants.js";
import { createInitialState } from "./timer_engine.js";
import { normalizeSettings } from "./validation.js";

const MEMORY = {
  settings: null,
  state: null
};

const MODE_SET = new Set(Object.values(MODES));

function getChromeStorageArea(areaName) {
  return globalThis.chrome?.storage?.[areaName] ?? null;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function normalizeMode(value, fallback = DEFAULT_STATE.mode) {
  return MODE_SET.has(value) ? value : fallback;
}

function getDurationForMode(mode, settings, previousMode) {
  const effectiveMode = mode === MODES.paused ? previousMode : mode;

  if (effectiveMode === MODES.shortBreak) {
    return settings.shortBreakMinutes * 60 * 1000;
  }

  if (effectiveMode === MODES.longBreak) {
    return settings.longBreakMinutes * 60 * 1000;
  }

  return settings.workMinutes * 60 * 1000;
}

export function normalizeState(input = {}, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const raw = input && typeof input === "object" ? input : {};
  const mode = normalizeMode(raw.mode);
  const previousMode = normalizeMode(raw.previousMode, MODES.work);
  const currentSessionStart = Math.max(0, toFiniteNumber(raw.currentSessionStart, now));
  const fallbackDuration = getDurationForMode(mode, settings, previousMode);
  let currentSessionEnd = toFiniteNumber(raw.currentSessionEnd, currentSessionStart + fallbackDuration);

  if (!Number.isFinite(currentSessionEnd) || currentSessionEnd < currentSessionStart) {
    currentSessionEnd = currentSessionStart + fallbackDuration;
  }

  const normalized = {
    mode,
    previousMode,
    cycleCount: clampInteger(raw.cycleCount, 0, 999, DEFAULT_STATE.cycleCount),
    currentSessionStart,
    currentSessionEnd,
    lastReminderAt: Math.max(0, toFiniteNumber(raw.lastReminderAt, DEFAULT_STATE.lastReminderAt)),
    snoozedUntil: Math.max(0, toFiniteNumber(raw.snoozedUntil, DEFAULT_STATE.snoozedUntil)),
    notificationOpen: Boolean(raw.notificationOpen),
    notificationTabId:
      raw.notificationTabId === null || raw.notificationTabId === undefined
        ? null
        : toOptionalInteger(raw.notificationTabId),
    reminderKind: raw.reminderKind === "due" || raw.reminderKind === "test" ? raw.reminderKind : null
  };

  if (Boolean(raw.preserveSessionEnd)) {
    normalized.preserveSessionEnd = true;
  }

  if (typeof raw.pausedRemainingMs !== "undefined") {
    const pausedRemainingMs = Math.max(0, toFiniteNumber(raw.pausedRemainingMs, 0));
    if (pausedRemainingMs > 0) {
      normalized.pausedRemainingMs = pausedRemainingMs;
    }
  }

  return normalized;
}

async function readFromStorage(area, key, fallback) {
  if (!area) {
    return fallback;
  }

  const result = await area.get(key);
  return result?.[key] ?? fallback;
}

async function writeToStorage(area, key, value) {
  if (!area) {
    return value;
  }

  await area.set({ [key]: value });
  return value;
}

export async function readSettings() {
  const area = getChromeStorageArea("sync");
  const rawSettings = await readFromStorage(area, STORAGE_KEYS.settings, null);
  const normalizedSettings = normalizeSettings(rawSettings ?? DEFAULT_SETTINGS);

  if (area && rawSettings == null) {
    await writeToStorage(area, STORAGE_KEYS.settings, normalizedSettings);
  }

  if (!area) {
    MEMORY.settings = normalizedSettings;
  }

  return normalizedSettings;
}

export async function writeSettings(input) {
  const area = getChromeStorageArea("sync");
  const normalizedSettings = normalizeSettings(input ?? DEFAULT_SETTINGS);

  if (area) {
    await writeToStorage(area, STORAGE_KEYS.settings, normalizedSettings);
  } else {
    MEMORY.settings = normalizedSettings;
  }

  return normalizedSettings;
}

export async function readState(now = Date.now(), settings = null) {
  const area = getChromeStorageArea("local");
  const effectiveSettings = settings ?? (await readSettings());
  const rawState = await readFromStorage(area, STORAGE_KEYS.state, null);

  if (rawState == null) {
    const initialState = createInitialState(now, effectiveSettings);
    if (area) {
      await writeToStorage(area, STORAGE_KEYS.state, initialState);
    } else {
      MEMORY.state = initialState;
    }
    return initialState;
  }

  const normalizedState = normalizeState(rawState, now, effectiveSettings);

  if (area) {
    await writeToStorage(area, STORAGE_KEYS.state, normalizedState);
  } else {
    MEMORY.state = normalizedState;
  }

  return normalizedState;
}

export async function writeState(input) {
  const area = getChromeStorageArea("local");
  const normalizedState = normalizeState(input ?? DEFAULT_STATE);

  if (area) {
    await writeToStorage(area, STORAGE_KEYS.state, normalizedState);
  } else {
    MEMORY.state = normalizedState;
  }

  return normalizedState;
}

export async function loadSnapshot(now = Date.now()) {
  const settings = await readSettings();
  const state = await readState(now, settings);
  return { settings, state };
}

export async function clearState(now = Date.now(), settings = null) {
  const effectiveSettings = settings ?? (await readSettings());
  const initialState = createInitialState(now, effectiveSettings);
  await writeState(initialState);
  return initialState;
}
