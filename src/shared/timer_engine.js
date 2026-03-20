import { DEFAULT_STATE, MODES } from "./constants.js";

export function createInitialState(now, settings) {
  return {
    ...DEFAULT_STATE,
    currentSessionStart: now,
    currentSessionEnd: now + settings.workMinutes * 60 * 1000
  };
}

export function createNextBreakState(state, settings, now) {
  const nextCycleCount = state.cycleCount + 1;
  const longBreakDue = nextCycleCount >= settings.longBreakEvery;
  const mode = longBreakDue ? MODES.longBreak : MODES.shortBreak;
  const breakMinutes = longBreakDue ? settings.longBreakMinutes : settings.shortBreakMinutes;

  return {
    ...state,
    mode,
    cycleCount: longBreakDue ? 0 : nextCycleCount,
    currentSessionStart: now,
    currentSessionEnd: now + breakMinutes * 60 * 1000,
    lastReminderAt: now,
    snoozedUntil: 0
  };
}

export function createNextWorkState(state, settings, now) {
  return {
    ...state,
    mode: MODES.work,
    currentSessionStart: now,
    currentSessionEnd: now + settings.workMinutes * 60 * 1000,
    snoozedUntil: 0
  };
}

export function applySnooze(state, minutes, now) {
  return {
    ...state,
    lastReminderAt: now,
    snoozedUntil: now + minutes * 60 * 1000
  };
}

export function isSessionDue(state, now) {
  if (state.mode === MODES.paused) {
    return false;
  }

  const target = state.snoozedUntil > now ? state.snoozedUntil : state.currentSessionEnd;
  return now >= target;
}

export function getRemainingMs(state, now) {
  const target = state.snoozedUntil > now ? state.snoozedUntil : state.currentSessionEnd;
  return Math.max(0, target - now);
}

export function pauseState(state) {
  return {
    ...state,
    previousMode: state.mode,
    mode: MODES.paused
  };
}

export function resumeState(state) {
  return {
    ...state,
    mode: state.previousMode || MODES.work
  };
}
