import { DEFAULT_SETTINGS, DEFAULT_STATE, MODES, STORAGE_KEYS } from "./constants.js";
import { createInitialState } from "./timer_engine.js";
import { normalizeBoolean, normalizeSettings } from "./validation.js";

const MEMORY = {
  [STORAGE_KEYS.settings]: null,
  [STORAGE_KEYS.state]: null
};

const MODE_SET = new Set(Object.values(MODES));
const RESUMABLE_MODE_SET = new Set([MODES.work, MODES.shortBreak, MODES.longBreak]);

function getChromeStorageArea(areaName) {
  return globalThis.chrome?.storage?.[areaName] ?? null;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalInteger(value) {
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
  if (typeof value !== "number" && typeof value !== "string") {
    return fallback;
  }
  if (typeof value === "string" && value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function normalizeMode(value, fallback = DEFAULT_STATE.mode) {
  return MODE_SET.has(value) ? value : fallback;
}

function normalizePreviousMode(value) {
  return RESUMABLE_MODE_SET.has(value) ? value : MODES.work;
}

function getDurationForMode(mode, settings, previousMode) {
  const effectiveSettings = settings ?? DEFAULT_SETTINGS;
  const effectiveMode = mode === MODES.paused ? previousMode : mode;

  if (effectiveMode === MODES.shortBreak) {
    return effectiveSettings.shortBreakMinutes * 60 * 1000;
  }

  if (effectiveMode === MODES.longBreak) {
    return effectiveSettings.longBreakMinutes * 60 * 1000;
  }

  return effectiveSettings.workMinutes * 60 * 1000;
}

export function normalizeState(input = {}, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const raw = input && typeof input === "object" ? input : {};
  const mode = normalizeMode(raw.mode);
  const previousMode = normalizePreviousMode(raw.previousMode);
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
    notificationOpen: normalizeBoolean(raw.notificationOpen, DEFAULT_STATE.notificationOpen),
    notificationTabId:
      raw.notificationTabId === null || raw.notificationTabId === undefined
        ? null
        : toOptionalInteger(raw.notificationTabId),
    reminderKind: raw.reminderKind === "due" || raw.reminderKind === "test" ? raw.reminderKind : null
  };

  if (normalizeBoolean(raw.preserveSessionEnd, false)) {
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
    return MEMORY[key] ?? fallback;
  }

  const result = await area.get(key);
  return result?.[key] ?? fallback;
}

async function writeToStorage(area, key, value) {
  if (!area) {
    MEMORY[key] = value;
    return value;
  }

  await area.set({ [key]: value });
  return value;
}

export async function readSettings({ persistIfMissing = true } = {}) {
  const area = getChromeStorageArea("sync");
  const rawSettings = await readFromStorage(area, STORAGE_KEYS.settings, null);
  const normalizedSettings = normalizeSettings(rawSettings ?? DEFAULT_SETTINGS);

  if (rawSettings == null && persistIfMissing) {
    await writeToStorage(area, STORAGE_KEYS.settings, normalizedSettings);
  }

  return normalizedSettings;
}

export async function writeSettings(input) {
  const area = getChromeStorageArea("sync");
  const normalizedSettings = normalizeSettings(input ?? DEFAULT_SETTINGS);
  await writeToStorage(area, STORAGE_KEYS.settings, normalizedSettings);
  return normalizedSettings;
}

export async function readState(now = Date.now(), settings = null, { persistIfMissing = true } = {}) {
  const area = getChromeStorageArea("local");
  const effectiveSettings = settings ?? (await readSettings());
  const rawState = await readFromStorage(area, STORAGE_KEYS.state, null);

  if (rawState == null) {
    const initialState = createInitialState(now, effectiveSettings);
    if (persistIfMissing) {
      await writeState(initialState, effectiveSettings);
    }
    return initialState;
  }

  return normalizeState(rawState, now, effectiveSettings);
}

export async function writeState(input, settings = DEFAULT_SETTINGS) {
  const area = getChromeStorageArea("local");
  const normalizedState = normalizeState(input ?? DEFAULT_STATE, Date.now(), settings);
  await writeToStorage(area, STORAGE_KEYS.state, normalizedState);
  return normalizedState;
}

export async function loadSnapshot(now = Date.now(), { persistIfMissing = true } = {}) {
  const settings = await readSettings({ persistIfMissing });
  const state = await readState(now, settings, { persistIfMissing });
  return { settings, state };
}

export async function clearState(now = Date.now(), settings = null) {
  const effectiveSettings = settings ?? (await readSettings());
  const initialState = createInitialState(now, effectiveSettings);
  await writeState(initialState);
  return initialState;
}
