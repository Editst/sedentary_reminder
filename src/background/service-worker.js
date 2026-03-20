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
const ICON_URL = globalThis.chrome.runtime.getURL("src/assets/icons/time-reminder-128.png");
const REMINDER_KINDS = {
  due: "due",
  test: "test"
};

const MODE_LABELS = {
  [MODES.work]: "专注工作",
  [MODES.shortBreak]: "短休息",
  [MODES.longBreak]: "长休息",
  [MODES.paused]: "已暂停"
};

function isReminderUrl(url) {
  return typeof url === "string" && url.startsWith(REMINDER_URL);
}

function getReminderTitle(state, settings) {
  if (state.reminderKind === REMINDER_KINDS.test) {
    return "测试提醒";
  }

  if (state.mode === MODES.shortBreak) {
    return "短休息时间";
  }

  if (state.mode === MODES.longBreak) {
    return "长休息时间";
  }

  return settings.reminderTitle;
}

function getReminderMessage(state, settings) {
  if (state.reminderKind === REMINDER_KINDS.test) {
    return "这是一次测试提醒，用来确认通知和提醒页显示正常。";
  }

  if (state.mode === MODES.shortBreak || state.mode === MODES.longBreak) {
    return "离开屏幕片刻，让身体和注意力都缓一缓。";
  }

  return settings.reminderBody;
}

function buildStatus(state, settings, now = Date.now()) {
  const remainingMs = getRemainingMs(state, now);
  const due = state.mode === MODES.work
    ? isSessionDue(state, now)
    : state.mode !== MODES.paused && state.currentSessionEnd <= now;
  const effectiveMode = state.mode === MODES.paused ? state.previousMode : state.mode;
  const hasActiveReminder = Boolean(state.notificationOpen && state.notificationTabId != null && state.reminderKind);
  const reminderIsDue = hasActiveReminder && state.reminderKind === REMINDER_KINDS.due;
  const reminderIsTest = hasActiveReminder && state.reminderKind === REMINDER_KINDS.test;

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
    reminderKind: state.reminderKind ?? null,
    hasActiveReminder,
    reminderTitle: getReminderTitle(state, settings),
    reminderMessage: getReminderMessage(state, settings),
    autoCloseSeconds: settings.reminderAutoCloseSeconds,
    currentPhaseLabel: due && state.mode === MODES.work ? "提醒已到" : MODE_LABELS[effectiveMode] ?? effectiveMode,
    canPause: state.mode !== MODES.paused,
    canResume: state.mode === MODES.paused,
    canStartBreak: reminderIsDue && state.mode === MODES.work,
    canEndBreak: reminderIsDue && (state.mode === MODES.shortBreak || state.mode === MODES.longBreak),
    canSnooze: reminderIsDue && state.mode === MODES.work,
    canCloseReminder: hasActiveReminder || reminderIsTest
  };
}

function resetRuntimeState(state) {
  return {
    ...state,
    notificationOpen: false,
    notificationTabId: null,
    snoozedUntil: 0,
    reminderKind: null
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

async function listReminderTabs() {
  const tabs = await globalThis.chrome.tabs.query({ url: `${REMINDER_URL}*` });
  return tabs.filter((tab) => isReminderUrl(tab.url));
}

async function normalizeReminderTabs(preferredTabId = null) {
  const tabs = await listReminderTabs();
  if (tabs.length === 0) {
    return null;
  }

  const canonical = tabs.find((tab) => tab.id === preferredTabId) ?? tabs[0];
  const duplicates = tabs.filter((tab) => tab.id !== canonical.id);

  if (duplicates.length > 0) {
    await Promise.all(
      duplicates.map(async (tab) => {
        if (tab.id == null) {
          return;
        }

        try {
          await globalThis.chrome.tabs.remove(tab.id);
        } catch {
          // Duplicate tab may already be gone.
        }
      })
    );
  }

  return canonical;
}

async function syncReminderWindowState(state) {
  const canonical = await normalizeReminderTabs(state.notificationTabId);
  if (canonical?.id != null) {
    if (!state.notificationOpen || state.notificationTabId !== canonical.id) {
      const nextState = {
        ...state,
        notificationOpen: true,
        notificationTabId: canonical.id
      };
      await writeState(nextState);
      return nextState;
    }

    return state;
  }

  if (state.notificationOpen || state.notificationTabId != null) {
    const nextState = {
      ...state,
      notificationOpen: false,
      notificationTabId: null,
      reminderKind: null
    };
    await writeState(nextState);
    return nextState;
  }

  return state;
}

async function openReminderTab(state) {
  const canonical = await normalizeReminderTabs(state.notificationTabId);
  if (canonical) {
    await focusTab(canonical);
    const nextState = {
      ...state,
      notificationOpen: true,
      notificationTabId: canonical.id ?? null
    };
    await writeState(nextState);
    return nextState;
  }

  const tab = await globalThis.chrome.tabs.create({ url: REMINDER_URL, active: true });
  const nextState = {
    ...state,
    notificationOpen: true,
    notificationTabId: tab.id ?? null
  };
  await writeState(nextState);
  return nextState;
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

async function createSystemNotification(settings, title, message) {
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
  const nextState = {
    ...state,
    reminderKind: REMINDER_KINDS.due,
    lastReminderAt: now
  };
  await createSystemNotification(settings, getReminderTitle(nextState, settings), getReminderMessage(nextState, settings));
  return openReminderTab(nextState);
}

async function showTestReminder(state, settings, now) {
  const nextState = {
    ...state,
    reminderKind: REMINDER_KINDS.test,
    lastReminderAt: now
  };
  await createSystemNotification(settings, getReminderTitle(nextState, settings), getReminderMessage(nextState, settings));
  return openReminderTab(nextState);
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

  state = await syncReminderWindowState(state);

  if (state.mode === MODES.paused) {
    await globalThis.chrome.alarms.clear(MAIN_ALARM);
    return buildStatus(state, settings, now);
  }

  if (state.mode === MODES.shortBreak || state.mode === MODES.longBreak) {
    if (isSessionDue(state, now)) {
      state = clearResumeLock(createNextWorkState(state, settings, now));
      state.notificationOpen = false;
      state.notificationTabId = null;
      state.reminderKind = null;
      await writeState(state);
      await closeReminderTab(snapshot.state.notificationTabId);
    }

    await scheduleMainAlarm(state.currentSessionEnd);
    return buildStatus(state, settings, now);
  }

  state = applySettingsToState(state, settings);
  const target = state.snoozedUntil > now ? state.snoozedUntil : state.currentSessionEnd;
  const due = target <= now;

  if (due) {
    await globalThis.chrome.alarms.clear(MAIN_ALARM);
    if (openDueReminder) {
      state = await showDueReminder(state, settings, now);
    }
    return buildStatus(state, settings, now);
  }

  if (state.reminderKind === REMINDER_KINDS.test && !state.notificationOpen) {
    const cleanedState = {
      ...state,
      reminderKind: null
    };
    await writeState(cleanedState);
    state = cleanedState;
  }

  await scheduleMainAlarm(target);
  return buildStatus(state, settings, now);
}

async function handleSaveSettings(payload) {
  const settings = await writeSettings(payload);
  const snapshot = await loadSnapshot(Date.now());
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
  nextState.reminderKind = null;
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

  const nextState = applySnooze(clearResumeLock(snapshot.state), minutes, now);
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  nextState.reminderKind = null;
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

  const status = buildStatus(snapshot.state, snapshot.settings, now);
  if (!status.canStartBreak) {
    return status;
  }

  const nextState = clearResumeLock(createNextBreakState(snapshot.state, snapshot.settings, now));
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  nextState.reminderKind = null;
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

  const status = buildStatus(snapshot.state, snapshot.settings, now);
  if (!status.canEndBreak) {
    return status;
  }

  const nextState = clearResumeLock(createNextWorkState(snapshot.state, snapshot.settings, now));
  nextState.notificationOpen = false;
  nextState.notificationTabId = null;
  nextState.reminderKind = null;
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
    notificationTabId: null,
    reminderKind: null
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

  const nextState = await showTestReminder(snapshot.state, snapshot.settings, now);
  return buildStatus(nextState, snapshot.settings, now);
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
      notificationTabId: null,
      reminderKind: null
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
