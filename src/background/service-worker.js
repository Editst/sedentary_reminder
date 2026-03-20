import { MAIN_ALARM, MESSAGE_TYPES, MODES, NOTIFICATION_ID } from "../shared/constants.js";
import {
  applySnooze,
  createNextBreakState,
  createNextWorkState,
  getRemainingMs,
  isSessionDue,
  pauseState,
  resumeState
} from "../shared/timer_engine.js";
import { loadSnapshot, writeSettings, writeState } from "../shared/storage.js";

const REMINDER_PATH = "src/notification/notification.html";
const REMINDER_URL = globalThis.chrome.runtime.getURL(REMINDER_PATH);
const REMINDER_TEST_URL = `${REMINDER_URL}?test=1`;
const ICON_URL = globalThis.chrome.runtime.getURL("src/assets/icons/time-reminder-128.png");

const MODE_LABELS = {
  [MODES.work]: "Working",
  [MODES.shortBreak]: "Short break",
  [MODES.longBreak]: "Long break",
  [MODES.paused]: "Paused"
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isActualReminderUrl(url) {
  return typeof url === "string" && url.startsWith(REMINDER_URL) && !url.includes("test=1");
}

function isTestReminderUrl(url) {
  return typeof url === "string" && url.startsWith(REMINDER_URL) && url.includes("test=1");
}

function buildStatus(state, settings, now = Date.now()) {
  const remainingMs = getRemainingMs(state, now);
  const due = state.mode === MODES.work ? isSessionDue(state, now) : state.mode !== MODES.paused && state.currentSessionEnd <= now;
  const effectiveMode = state.mode === MODES.paused ? state.previousMode : state.mode;

  return {
    now,
    settings,
    state,
    enabled: Boolean(settings.enabled),
    due,
    remainingMs,
    modeLabel: MODE_LABELS[state.mode] ?? state.mode,
    effectiveMode,
    reminderVisible: Boolean(state.notificationOpen),
    currentPhaseLabel: due && state.mode === MODES.work ? "Reminder due" : MODE_LABELS[effectiveMode] ?? effectiveMode,
    canPause: state.mode !== MODES.paused,
    canResume: state.mode === MODES.paused,
    canStartBreak: state.mode === MODES.work && due,
    canEndBreak: state.mode === MODES.shortBreak || state.mode === MODES.longBreak,
    canSnooze: state.mode === MODES.work && due
  };
}

function resetRuntimeState(state) {
  return {
    ...state,
    notificationOpen: false,
    notificationTabId: null,
    snoozedUntil: 0
  };
}

function clearResumeLock(state) {
  const nextState = { ...state };
  delete nextState.pausedRemainingMs;
  delete nextState.preserveSessionEnd;
  return nextState;
}

async function scheduleMainAlarm(whenMs) {
  await globalThis.chrome.alarms.clear(MAIN_ALARM);
  if (whenMs == null) {
    return;
  }

  const triggerAt = Math.max(Date.now() + 1000, Math.floor(whenMs));
  await globalThis.chrome.alarms.create(MAIN_ALARM, { when: triggerAt });
}

async function focusTab(tab) {
  if (!tab?.id) {
    return;
  }

  try {
    await globalThis.chrome.tabs.update(tab.id, { active: true });
  } catch {
    return;
  }

  if (tab.windowId != null && tab.windowId >= 0) {
    try {
      await globalThis.chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // Ignore window focus failures.
    }
  }
}

async function findReminderTab(test = false) {
  const tabs = await globalThis.chrome.tabs.query({ url: `${REMINDER_URL}*` });
  return tabs.find((tab) => (test ? isTestReminderUrl(tab.url) : isActualReminderUrl(tab.url))) ?? null;
}

async function openReminderTab({ test = false, trackState = true, state = null } = {}) {
  const existing = await findReminderTab(test);
  if (existing) {
    await focusTab(existing);
    if (trackState && state) {
      state.notificationOpen = !test;
      state.notificationTabId = existing.id ?? null;
      await writeState(state);
    }
    return existing;
  }

  const url = test ? REMINDER_TEST_URL : REMINDER_URL;
  const tab = await globalThis.chrome.tabs.create({ url, active: true });

  if (trackState && state) {
    state.notificationOpen = !test;
    state.notificationTabId = tab.id ?? null;
    await writeState(state);
  }

  return tab;
}

async function closeReminderTab(tabId) {
  if (tabId == null) {
    return;
  }

  try {
    await globalThis.chrome.tabs.remove(tabId);
  } catch {
    // The tab may already be closed.
  }
}

async function createSystemNotification(settings, title = settings.reminderTitle, message = settings.reminderBody) {
  await globalThis.chrome.notifications.clear(NOTIFICATION_ID);
  await globalThis.chrome.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    iconUrl: ICON_URL,
    title,
    message,
    priority: 2,
    requireInteraction: true
  });
}

function applySettingsToState(state, settings) {
  if (state.mode === MODES.paused) {
    return state;
  }

  if (state.preserveSessionEnd) {
    return state;
  }

  if (state.mode === MODES.shortBreak) {
    return {
      ...state,
      currentSessionEnd: state.currentSessionStart + settings.shortBreakMinutes * 60 * 1000
    };
  }

  if (state.mode === MODES.longBreak) {
    return {
      ...state,
      currentSessionEnd: state.currentSessionStart + settings.longBreakMinutes * 60 * 1000
    };
  }

  return {
    ...state,
    currentSessionEnd: state.currentSessionStart + settings.workMinutes * 60 * 1000
  };
}

async function showDueReminder(state, settings, now) {
  if (!state.notificationOpen) {
    state.notificationOpen = true;
    state.lastReminderAt = now;
    await writeState(state);
  }

  await createSystemNotification(settings);
  await openReminderTab({ state });
}

async function disableRuntime(state, settings) {
  await globalThis.chrome.alarms.clear(MAIN_ALARM);
  await globalThis.chrome.notifications.clear(NOTIFICATION_ID);
  await closeReminderTab(state.notificationTabId);

  const nextState = clearResumeLock(resetRuntimeState({
    ...state,
    snoozedUntil: 0
  }));

  await writeState(nextState);
  return buildStatus(nextState, settings);
}

async function reconcileRuntime({ openDueReminder = false } = {}) {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  let { state, settings } = snapshot;

  if (!settings.enabled) {
    return disableRuntime(state, settings);
  }

  if (state.mode === MODES.paused) {
    await globalThis.chrome.alarms.clear(MAIN_ALARM);
    await closeReminderTab(state.notificationTabId);
    return buildStatus(state, settings, now);
  }

  if (state.mode === MODES.shortBreak || state.mode === MODES.longBreak) {
    if (isSessionDue(state, now)) {
      state = createNextWorkState(state, settings, now);
      state.notificationOpen = false;
      state.notificationTabId = null;
      await writeState(state);
      await closeReminderTab(snapshot.state.notificationTabId);
    }

    await scheduleMainAlarm(state.currentSessionEnd);
    return buildStatus(state, settings, now);
  }

  state = applySettingsToState(state, settings);
  if (state.notificationOpen && state.notificationTabId == null) {
    const existingTab = await findReminderTab(false);
    if (existingTab?.id != null) {
      state.notificationTabId = existingTab.id;
      await writeState(state);
    }
  }

  const target = state.snoozedUntil > now ? state.snoozedUntil : state.currentSessionEnd;
  const due = target <= now;

  if (due) {
    await globalThis.chrome.alarms.clear(MAIN_ALARM);
    if (openDueReminder) {
      await showDueReminder(state, settings, now);
    }
    return buildStatus(state, settings, now);
  }

  await scheduleMainAlarm(target);
  return buildStatus(state, settings, now);
}

async function handleSaveSettings(payload) {
  const now = Date.now();
  const settings = await writeSettings(payload);
  const snapshot = await loadSnapshot(now);
  if (!settings.enabled) {
    return disableRuntime(snapshot.state, settings);
  }

  const state = applySettingsToState(snapshot.state, settings);
  await writeState(state);
  return reconcileRuntime({ openDueReminder: true });
}

async function handlePause() {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const remainingMs = getRemainingMs(snapshot.state, now);
  const nextState = pauseState(snapshot.state);
  nextState.pausedRemainingMs = remainingMs;
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  await writeState(nextState);
  await closeReminderTab(snapshot.state.notificationTabId);
  await globalThis.chrome.alarms.clear(MAIN_ALARM);
  return buildStatus(nextState, snapshot.settings, now);
}

async function handleResume() {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const nextState = resumeState(snapshot.state);

  if (typeof snapshot.state.pausedRemainingMs === "number" && snapshot.state.pausedRemainingMs > 0) {
    nextState.currentSessionEnd = now + snapshot.state.pausedRemainingMs;
  }

  nextState.preserveSessionEnd = true;
  await writeState(nextState);
  return reconcileRuntime({ openDueReminder: true });
}

async function handleSnooze(minutes) {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const nextState = applySnooze(snapshot.state, minutes, now);
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  await writeState(nextState);
  await closeReminderTab(snapshot.state.notificationTabId);
  await scheduleMainAlarm(nextState.snoozedUntil);
  return buildStatus(nextState, snapshot.settings, now);
}

async function handleStartBreak() {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const nextState = clearResumeLock(createNextBreakState(snapshot.state, snapshot.settings, now));
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  await writeState(nextState);
  await closeReminderTab(snapshot.state.notificationTabId);
  await scheduleMainAlarm(nextState.currentSessionEnd);
  return buildStatus(nextState, snapshot.settings, now);
}

async function handleEndBreak() {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const nextState = clearResumeLock(createNextWorkState(snapshot.state, snapshot.settings, now));
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  await writeState(nextState);
  await closeReminderTab(snapshot.state.notificationTabId);
  await scheduleMainAlarm(nextState.currentSessionEnd);
  return buildStatus(nextState, snapshot.settings, now);
}

async function handleSkip() {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const nextState = {
    ...clearResumeLock(snapshot.state),
    lastReminderAt: now,
    notificationOpen: false,
    notificationTabId: null
  };
  await writeState(nextState);
  await closeReminderTab(snapshot.state.notificationTabId);
  await scheduleMainAlarm(now + snapshot.settings.breakCountdownSeconds * 1000);
  return buildStatus(nextState, snapshot.settings, now);
}

async function handleTestReminder() {
  const now = Date.now();
  const snapshot = await loadSnapshot(now);
  if (!snapshot.settings.enabled) {
    return disableRuntime(snapshot.state, snapshot.settings);
  }

  const actualReminder = await findReminderTab(false);

  if (actualReminder) {
    await focusTab(actualReminder);
    return buildStatus(snapshot.state, snapshot.settings, now);
  }

  await createSystemNotification(snapshot.settings, `${snapshot.settings.reminderTitle} (test)`, snapshot.settings.reminderBody);
  await openReminderTab({ test: true, trackState: false });
  return buildStatus(snapshot.state, snapshot.settings, now);
}

async function handleMessage(message) {
  switch (message?.type) {
    case MESSAGE_TYPES.getStatus:
      return reconcileRuntime({ openDueReminder: false });
    case MESSAGE_TYPES.saveSettings:
      return handleSaveSettings(message.settings);
    case MESSAGE_TYPES.pause:
      return handlePause();
    case MESSAGE_TYPES.resume:
      return handleResume();
    case MESSAGE_TYPES.snooze:
      return handleSnooze(Number.parseInt(message.minutes, 10) || 5);
    case MESSAGE_TYPES.startBreak:
      return handleStartBreak();
    case MESSAGE_TYPES.endBreak:
      return handleEndBreak();
    case MESSAGE_TYPES.skip:
      return handleSkip();
    case MESSAGE_TYPES.testReminder:
      return handleTestReminder();
    default:
      return reconcileRuntime({ openDueReminder: false });
  }
}

async function bootstrapRuntime() {
  await reconcileRuntime({ openDueReminder: true });
}

globalThis.chrome.runtime.onInstalled.addListener(() => {
  void bootstrapRuntime();
});

globalThis.chrome.runtime.onStartup.addListener(() => {
  void bootstrapRuntime();
});

globalThis.chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAIN_ALARM) {
    void reconcileRuntime({ openDueReminder: true });
  }
});

globalThis.chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === NOTIFICATION_ID) {
    void reconcileRuntime({ openDueReminder: true });
  }
});

globalThis.chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const snapshot = await loadSnapshot();
    if (snapshot.state.notificationTabId !== tabId) {
      return;
    }

    const nextState = {
      ...snapshot.state,
      notificationOpen: false,
      notificationTabId: null
    };
    await writeState(nextState);
  })();
});

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      const response = await handleMessage(message);
      sendResponse({ ok: true, data: response });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return true;
});

void bootstrapRuntime();

