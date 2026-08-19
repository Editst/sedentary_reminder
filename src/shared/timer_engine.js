import { DEFAULT_STATE, MODES, RESUMABLE_MODES, DEFAULT_SETTINGS } from "./constants.js";
import { toFiniteNumber } from "./validation.js";

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

export function createNextWorkState(state, settings, now, options = { countCycle: false }) {
  const newCycleCount = options.countCycle ? state.cycleCount + 1 : state.cycleCount;
  return {
    ...state,
    mode: MODES.work,
    cycleCount: newCycleCount,
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
    mode: RESUMABLE_MODES.includes(state.previousMode) ? state.previousMode : MODES.work
  };
}

export function parseTimeToMinutes(timeStr, fallbackStr) {
  const tryParse = (str) => {
    if (typeof str !== "string") return null;
    const parts = str.split(":");
    if (parts.length !== 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };

  const parsed = tryParse(timeStr);
  if (parsed !== null) return parsed;
  
  if (fallbackStr !== undefined) {
    const fallbackParsed = tryParse(fallbackStr);
    if (fallbackParsed !== null) return fallbackParsed;
  }
  
  return 0;
}

export function isWithinSchedule(settings, nowMs = Date.now()) {
  if (!settings?.scheduleEnabled) {
    return true;
  }

  const scheduleDays = Array.isArray(settings.scheduleDays) ? settings.scheduleDays : [];
  if (scheduleDays.length === 0) {
    return false;
  }

  const startMinutes = parseTimeToMinutes(settings.scheduleStartTime, DEFAULT_SETTINGS.scheduleStartTime);
  const endMinutes = parseTimeToMinutes(settings.scheduleEndTime, DEFAULT_SETTINGS.scheduleEndTime);

  if (startMinutes === endMinutes) {
    return false;
  }

  const date = new Date(nowMs);
  const currentDay = date.getDay(); // 0-6
  const currentMinutes = date.getHours() * 60 + date.getMinutes();

  if (startMinutes < endMinutes) {
    // Same-day window (e.g. 09:00 - 18:00)
    if (!scheduleDays.includes(currentDay)) {
      return false;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Cross-midnight window (e.g. 22:00 - 06:00)
  if (currentMinutes >= startMinutes) {
    // Night half: start day is today
    return scheduleDays.includes(currentDay);
  }

  if (currentMinutes < endMinutes) {
    // Morning half: started yesterday
    const yesterdayDay = (currentDay + 6) % 7;
    return scheduleDays.includes(yesterdayDay);
  }

  return false;
}

export function getNextScheduleStartTime(settings, nowMs = Date.now()) {
  if (!settings?.scheduleEnabled || isWithinSchedule(settings, nowMs)) {
    return nowMs;
  }

  const scheduleDays = Array.isArray(settings.scheduleDays) ? settings.scheduleDays : [];
  if (scheduleDays.length === 0) {
    return nowMs + 60 * 1000;
  }

  const startMinutes = parseTimeToMinutes(settings.scheduleStartTime, DEFAULT_SETTINGS.scheduleStartTime);
  const startH = Math.floor(startMinutes / 60);
  const startM = startMinutes % 60;

  const now = new Date(nowMs);

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dayOffset,
      startH,
      startM,
      0,
      0
    );

    const candidateMs = candidate.getTime();
    if (candidateMs > nowMs) {
      const candidateDay = candidate.getDay();
      if (scheduleDays.includes(candidateDay)) {
        return candidateMs;
      }
    }
  }

  return nowMs + 60 * 1000;
}

export function formatDurationMs(ms) {
  const totalSeconds = Math.max(0, Math.ceil(toFiniteNumber(ms, 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.floor(toFiniteNumber(seconds, 0)));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const secs = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}
