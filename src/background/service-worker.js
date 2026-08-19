import { MAIN_ALARM, MESSAGE_TYPES, MODES, NOTIFICATION_ID, REMINDER_KINDS } from "../shared/constants.js";
import {
  applySnooze,
  createInitialState,
  createNextBreakState,
  createNextWorkState,
  getNextScheduleStartTime,
  getRemainingMs,
  isSessionDue,
  isWithinSchedule,
  pauseState,
  resumeState
} from "../shared/timer_engine.js";
import { loadSnapshot, writeSettings, writeState } from "../shared/storage.js";

let _stateLock = Promise.resolve();

function withStateLock(fn) {
  const task = async () => {
    let timerId;
    const timeout = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error("State lock operation timed out")), 5000);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      clearTimeout(timerId);
    }
  };

  const next = _stateLock.then(task, task);
  _stateLock = next.catch(() => {});
  return next;
}

const REMINDER_PATH = "notification/notification.html";
const REMINDER_URL = globalThis.chrome.runtime.getURL(REMINDER_PATH);
const ICON_URL = globalThis.chrome.runtime.getURL("assets/icons/time-reminder-128.png");
const BADGE_TICK_ALARM = "time-reminder-badge-tick";

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

async function updateActionBadge(state, settings, now = Date.now()) {
  if (!globalThis.chrome?.action) {
    return;
  }

  try {
    if (!settings.enabled) {
      await globalThis.chrome.action.setBadgeText({ text: "OFF" });
      await globalThis.chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
      return;
    }

    if (!isWithinSchedule(settings, now)) {
      await globalThis.chrome.action.setBadgeText({ text: "ZZZ" });
      await globalThis.chrome.action.setBadgeBackgroundColor({ color: "#475569" });
      return;
    }

    if (state.mode === MODES.paused) {
      await globalThis.chrome.action.setBadgeText({ text: "||" });
      await globalThis.chrome.action.setBadgeBackgroundColor({ color: "#eab308" });
      return;
    }

    if (state.mode === MODES.shortBreak || state.mode === MODES.longBreak) {
      const remainingMinutes = Math.max(1, Math.ceil(getRemainingMs(state, now) / 60000));
      await globalThis.chrome.action.setBadgeText({ text: `${remainingMinutes}m` });
      await globalThis.chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
      return;
    }

    const due = isSessionDue(state, now);
    if (due) {
      await globalThis.chrome.action.setBadgeText({ text: "!" });
      await globalThis.chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      return;
    }

    const remainingMinutes = Math.ceil(getRemainingMs(state, now) / 60000);
    const badgeText = remainingMinutes > 99 ? "99+" : `${Math.max(1, remainingMinutes)}m`;
    await globalThis.chrome.action.setBadgeText({ text: badgeText });
    await globalThis.chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  } catch (error) {
    console.warn("[updateActionBadge] failed:", error);
  }
}

function normalizePreviousMode(state) {
  return state.mode === MODES.paused ? state.previousMode : state.mode;
}

function buildStatus(state, settings, now = Date.now()) {
  const inSchedule = isWithinSchedule(settings, now);
  const nextScheduleStart = inSchedule ? now : getNextScheduleStartTime(settings, now);
  const remainingMs = inSchedule ? getRemainingMs(state, now) : Math.max(0, nextScheduleStart - now);
  const due = inSchedule && (state.mode === MODES.work
    ? isSessionDue(state, now)
    : state.mode !== MODES.paused && state.currentSessionEnd <= now);
  const effectiveMode = normalizePreviousMode(state);
  const hasActiveReminder = Boolean(state.notificationOpen && state.notificationTabId != null && state.reminderKind);
  const reminderIsDue = hasActiveReminder && state.reminderKind === REMINDER_KINDS.due;
  const reminderIsTest = hasActiveReminder && state.reminderKind === REMINDER_KINDS.test;

  let currentPhaseLabel = MODE_LABELS[effectiveMode] ?? effectiveMode;
  if (!inSchedule) {
    currentPhaseLabel = "当前处于工作时段外";
  } else if (due && state.mode === MODES.work) {
    currentPhaseLabel = "提醒已到";
  }

  return {
    now,
    settings,
    state,
    enabled: Boolean(settings.enabled),
    inSchedule,
    nextScheduleStart,
    due,
    remainingMs,
    modeLabel: inSchedule ? (MODE_LABELS[state.mode] ?? state.mode) : "非生效时段",
    effectiveMode,
    reminderVisible: Boolean(state.notificationOpen),
    reminderKind: state.reminderKind ?? null,
    hasActiveReminder,
    reminderTitle: getReminderTitle(state, settings),
    reminderMessage: getReminderMessage(state, settings),
    autoCloseSeconds: settings.reminderAutoCloseSeconds,
    currentPhaseLabel,
    canPause: inSchedule && state.mode !== MODES.paused,
    canResume: inSchedule && state.mode === MODES.paused,
    canStartBreak: inSchedule && due && state.mode === MODES.work,
    canEndBreak: inSchedule && (state.mode === MODES.shortBreak || state.mode === MODES.longBreak),
    canSnooze: inSchedule && due && state.mode === MODES.work,
    canCloseReminder: hasActiveReminder || reminderIsTest
  };
}

function resetRuntimeState(state) {
  return {
    ...state,
    notificationOpen: false,
    notificationTabId: null,
    reminderKind: null
  };
}

function clearResumeLock(state) {
  const nextState = { ...state };
  delete nextState.pausedRemainingMs;
  delete nextState.preserveSessionEnd;
  return nextState;
}

async function startBadgeTick() {
  await globalThis.chrome.alarms.create(BADGE_TICK_ALARM, { periodInMinutes: 1 });
}

async function stopBadgeTick() {
  await globalThis.chrome.alarms.clear(BADGE_TICK_ALARM);
}

async function scheduleMainAlarm(whenMs) {
  await globalThis.chrome.alarms.clear(MAIN_ALARM);
  if (whenMs == null || !Number.isFinite(whenMs) || whenMs <= 0) {
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
  } catch (error) {
    console.warn(`[focusTab] chrome.tabs.update failed for tab ${tab.id}:`, error);
    return;
  }

  if (tab.windowId != null && tab.windowId >= 0) {
    try {
      await globalThis.chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    } catch (error) {
      console.warn(`[focusTab] chrome.windows.update failed for window ${tab.windowId}:`, error);
    }
  }
}

async function listReminderTabs() {
  const tabs = await globalThis.chrome.tabs.query({ url: `${REMINDER_URL}*` });
  return tabs.filter((tab) => isReminderUrl(tab.url));
}
async function removeTabsSafely(ids) {
  const tabIds = Array.isArray(ids) ? ids : [ids];
  const validIds = tabIds.filter((id) => Number.isInteger(id));
  if (validIds.length === 0) {
    return;
  }

  try {
    await globalThis.chrome.tabs.remove(validIds.length === 1 ? validIds[0] : validIds);
  } catch (error) {
    console.warn("[removeTabsSafely] chrome.tabs.remove failed:", error);
  }
}

async function normalizeReminderTabs(preferredTabId = null) {
  const tabs = await listReminderTabs();
  if (tabs.length === 0) {
    return null;
  }

  const canonical = tabs.find((tab) => tab.id === preferredTabId) ?? tabs[0];
  const idsToRemove = tabs
    .filter((tab) => tab.id !== canonical.id)
    .map((tab) => tab.id)
    .filter((id) => id != null);
  await removeTabsSafely(idsToRemove);

  return canonical;
}

async function syncReminderWindowState(state, settings, force = false) {
  if (!force && !state.notificationOpen && state.notificationTabId == null) {
    return state;
  }

  const canonical = await normalizeReminderTabs(state.notificationTabId);
  if (canonical?.id != null) {
    if (!state.notificationOpen || state.notificationTabId !== canonical.id) {
      const nextState = {
        ...state,
        notificationOpen: true,
        notificationTabId: canonical.id
      };
      await writeState(nextState, settings);
      return nextState;
    }

    return state;
  }

  if (state.notificationOpen || state.notificationTabId != null) {
    const nextState = resetRuntimeState(state);
    await writeState(nextState, settings);
    return nextState;
  }

  return state;
}

async function openReminderTab(state, settings) {
  const canonical = await normalizeReminderTabs(state.notificationTabId);
  if (canonical) {
    await focusTab(canonical);
    const nextState = {
      ...state,
      notificationOpen: true,
      notificationTabId: canonical.id ?? null
    };
    await writeState(nextState, settings);
    return nextState;
  }

  let tab = null;
  try {
    tab = await globalThis.chrome.tabs.create({ url: REMINDER_URL, active: true });
  } catch (tabError) {
    console.warn("[openReminderTab] tabs.create failed, attempting windows.create fallback:", tabError);
    try {
      const win = await globalThis.chrome.windows.create({ url: REMINDER_URL, focused: true, type: "popup" });
      tab = win?.tabs?.[0] ?? null;
    } catch (winError) {
      console.error("[openReminderTab] windows.create also failed:", winError);
    }
  }

  if (!tab) {
    const nextState = resetRuntimeState(state);
    await writeState(nextState, settings);
    return nextState;
  }

  await focusTab(tab);

  const nextState = {
    ...state,
    notificationOpen: true,
    notificationTabId: tab.id ?? null
  };
  await writeState(nextState, settings);
  return nextState;
}

async function closeReminderTab(tabId) {
  await globalThis.chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});

  if (tabId == null) {
    return;
  }

  await removeTabsSafely(tabId);
}

async function createSystemNotification(settings, title, message) {
  try {
    await globalThis.chrome.notifications.clear(NOTIFICATION_ID);
    await globalThis.chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: ICON_URL,
      title,
      message,
      priority: 2,
      requireInteraction: false
    });
  } catch (error) {
    console.warn("[createSystemNotification] chrome.notifications failed:", error);
  }
}

function applySettingsToState(state, settings) {
  if (state.mode === MODES.paused || state.preserveSessionEnd) {
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

async function showReminder(state, settings, now, kind) {
  const nextState = {
    ...state,
    reminderKind: kind,
    lastReminderAt: now
  };
  await createSystemNotification(
    settings,
    getReminderTitle(nextState, settings),
    getReminderMessage(nextState, settings)
  );
  return openReminderTab(nextState, settings);
}

async function disableRuntime(state, settings) {
  await globalThis.chrome.alarms.clear(MAIN_ALARM);
  await stopBadgeTick();
  await globalThis.chrome.notifications.clear(NOTIFICATION_ID);
  await closeReminderTab(state.notificationTabId);

  const nextState = clearResumeLock(resetRuntimeState(state));
  nextState.snoozedUntil = 0;
  await writeState(nextState, settings);
  await updateActionBadge(nextState, settings);
  return buildStatus(nextState, settings);
}

async function _reconcileRuntimeInner(now, { openDueReminder = false, isBadgeTick = false } = {}) {
  const snapshot = await loadSnapshot(now);
  let { state, settings } = snapshot;

  if (!settings.enabled) {
    return disableRuntime(state, settings);
  }

  const shouldSync = !isBadgeTick || state.notificationOpen;
  state = await syncReminderWindowState(state, settings, shouldSync);

  const inSchedule = isWithinSchedule(settings, now);
  if (!inSchedule) {
    await globalThis.chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});
    await closeReminderTab(state.notificationTabId);
    await stopBadgeTick();

    const nextScheduleStart = getNextScheduleStartTime(settings, now);
    await scheduleMainAlarm(nextScheduleStart);

    let nextState = resetRuntimeState(state);
    if (nextState.mode !== MODES.paused) {
      nextState = createInitialState(nextScheduleStart, settings);
    }
    await writeState(nextState, settings);
    await updateActionBadge(nextState, settings, now);
    return buildStatus(nextState, settings, now);
  }

  if (state.mode === MODES.paused) {
    await globalThis.chrome.alarms.clear(MAIN_ALARM);
    await stopBadgeTick();
    await updateActionBadge(state, settings, now);
    return buildStatus(state, settings, now);
  }

  if (state.mode === MODES.shortBreak || state.mode === MODES.longBreak) {
    if (isSessionDue(state, now)) {
      state = clearResumeLock(createNextWorkState(state, settings, now));
      state.notificationOpen = false;
      state.notificationTabId = null;
      state.reminderKind = null;
      await writeState(state, settings);
      await closeReminderTab(snapshot.state.notificationTabId);
      await createSystemNotification(
        settings,
        "休息结束",
        "休息时间已到，准备好开始新的专注工作了吗？"
      );
    }

    await scheduleMainAlarm(state.currentSessionEnd);
    await startBadgeTick();
    await updateActionBadge(state, settings, now);
    return buildStatus(state, settings, now);
  }

  state = applySettingsToState(state, settings);
  const target = state.snoozedUntil > now ? state.snoozedUntil : state.currentSessionEnd;
  const due = target <= now;

  if (due) {
    if (openDueReminder) {
      await globalThis.chrome.alarms.clear(MAIN_ALARM);
      state = await showReminder(state, settings, now, REMINDER_KINDS.due);
    }
    
    if (!state.notificationOpen) {
      await scheduleMainAlarm(now + 60 * 1000);
    }
    await startBadgeTick();
    await updateActionBadge(state, settings, now);
    return buildStatus(state, settings, now);
  }

  if (state.reminderKind === REMINDER_KINDS.test && !state.notificationOpen) {
    const cleanedState = {
      ...state,
      reminderKind: null
    };
    await writeState(cleanedState, settings);
    state = cleanedState;
  }

  await scheduleMainAlarm(target);
  await startBadgeTick();
  await updateActionBadge(state, settings, now);
  return buildStatus(state, settings, now);
}

async function persistInitialSnapshotIfNeeded(now) {
  await loadSnapshot(now, { persistIfMissing: true });
}

function reconcileRuntime({ openDueReminder = false, isBadgeTick = false } = {}) {
  return withStateLock(() => _reconcileRuntimeInner(Date.now(), { openDueReminder, isBadgeTick }));
}

function handleSaveSettings(payload) {
  return withStateLock(async () => {
    const now = Date.now();
    const prevSnapshot = await loadSnapshot(now);
    const wasEnabled = Boolean(prevSnapshot.settings.enabled);
    const wasInSchedule = isWithinSchedule(prevSnapshot.settings, now);

    const settings = await writeSettings(payload);
    const snapshot = await loadSnapshot(now);
    if (!settings.enabled) {
      return disableRuntime(snapshot.state, settings);
    }

    const nowInSchedule = isWithinSchedule(settings, now);
    let state = snapshot.state;

    if (state.mode !== MODES.paused && ((!wasEnabled && settings.enabled) || (!wasInSchedule && nowInSchedule))) {
      state = createInitialState(now, settings);
    } else {
      const baseState = state.mode === MODES.paused ? snapshot.state : clearResumeLock(snapshot.state);
      state = applySettingsToState(baseState, settings);
    }

    await writeState(state, settings);
    return _reconcileRuntimeInner(now, { openDueReminder: true });
  });
}

function isAllowedPause(status) {
  return status.canPause;
}

function isAllowedResume(status) {
  return status.canResume;
}

function isAllowedSkip(status, state) {
  const canDismissTest = state.reminderKind === REMINDER_KINDS.test && status.hasActiveReminder;
  return canDismissTest || status.canStartBreak;
}

function handlePause() {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }

    const status = buildStatus(snapshot.state, snapshot.settings, now);
    if (!isAllowedPause(status)) {
      return status;
    }

    const remainingMs = getRemainingMs(snapshot.state, now);
    const nextState = resetRuntimeState(pauseState(snapshot.state));
    nextState.pausedRemainingMs = remainingMs;
    return commitTransition(snapshot, nextState, null, now);
  });
}

function handleResume() {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }

    const status = buildStatus(snapshot.state, snapshot.settings, now);
    if (!isAllowedResume(status)) {
      return status;
    }

    const nextState = resumeState(snapshot.state);
    nextState.snoozedUntil = 0;

    const effectiveMode = nextState.mode;
    const modeDuration =
      effectiveMode === MODES.shortBreak
        ? snapshot.settings.shortBreakMinutes * 60 * 1000
        : effectiveMode === MODES.longBreak
          ? snapshot.settings.longBreakMinutes * 60 * 1000
          : snapshot.settings.workMinutes * 60 * 1000;

    if (typeof snapshot.state.pausedRemainingMs === "number" && snapshot.state.pausedRemainingMs > 0) {
      const effectiveRemainingMs = Math.min(snapshot.state.pausedRemainingMs, modeDuration);
      nextState.currentSessionEnd = now + effectiveRemainingMs;
      nextState.currentSessionStart = nextState.currentSessionEnd - modeDuration;
    } else {
      nextState.currentSessionStart = now;
      nextState.currentSessionEnd = now + modeDuration;
    }

    nextState.preserveSessionEnd = true;
    return commitTransition(snapshot, nextState, nextState.currentSessionEnd, now);
  });
}

function isAllowedSnooze(status, minutes, settings) {
  return status.canSnooze && settings.snoozeMinutesOptions.includes(minutes);
}

async function commitTransition(snapshot, nextState, alarmTarget, now) {
  await writeState(nextState, snapshot.settings);
  await closeReminderTab(snapshot.state.notificationTabId);
  if (alarmTarget != null) {
    await scheduleMainAlarm(alarmTarget);
  } else {
    await globalThis.chrome.alarms.clear(MAIN_ALARM);
  }
  
  if (nextState.mode === MODES.paused) {
    await stopBadgeTick();
  } else {
    await startBadgeTick();
  }

  await updateActionBadge(nextState, snapshot.settings, now);
  return buildStatus(nextState, snapshot.settings, now);
}

function handleSnooze(minutes) {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }

    const status = buildStatus(snapshot.state, snapshot.settings, now);
    if (!isAllowedSnooze(status, minutes, snapshot.settings)) {
      return status;
    }

    const nextState = resetRuntimeState(applySnooze(clearResumeLock(snapshot.state), minutes, now));
    return commitTransition(snapshot, nextState, nextState.snoozedUntil, now);
  });
}

function handleStartBreak() {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }

    const status = buildStatus(snapshot.state, snapshot.settings, now);
    if (!status.canStartBreak) {
      return status;
    }

    const nextState = resetRuntimeState(clearResumeLock(createNextBreakState(snapshot.state, snapshot.settings, now)));
    return commitTransition(snapshot, nextState, nextState.currentSessionEnd, now);
  });
}

function handleEndBreak() {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }

    const status = buildStatus(snapshot.state, snapshot.settings, now);
    if (!status.canEndBreak) {
      return status;
    }

    const nextState = resetRuntimeState(clearResumeLock(createNextWorkState(snapshot.state, snapshot.settings, now)));
    return commitTransition(snapshot, nextState, nextState.currentSessionEnd, now);
  });
}

function handleSkip() {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }

    const status = buildStatus(snapshot.state, snapshot.settings, now);
    if (!isAllowedSkip(status, snapshot.state)) {
      return status;
    }

    if (snapshot.state.reminderKind === REMINDER_KINDS.test) {
      const nextState = resetRuntimeState(snapshot.state);
      const target = nextState.snoozedUntil > now ? nextState.snoozedUntil : nextState.currentSessionEnd;
      return commitTransition(snapshot, nextState, target, now);
    }

    const nextState = resetRuntimeState({
      ...clearResumeLock(createNextWorkState(snapshot.state, snapshot.settings, now, { countCycle: true })),
      lastReminderAt: now
    });
    return commitTransition(snapshot, nextState, nextState.currentSessionEnd, now);
  });
}

function handleTestReminder() {
  return withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (!snapshot.settings.enabled) {
      return disableRuntime(snapshot.state, snapshot.settings);
    }
    
    if (snapshot.state.notificationOpen && snapshot.state.reminderKind === REMINDER_KINDS.due) {
      return buildStatus(snapshot.state, snapshot.settings, now);
    }

    if (isSessionDue(snapshot.state, now)) {
      return buildStatus(snapshot.state, snapshot.settings, now);
    }

    const nextState = await showReminder(snapshot.state, snapshot.settings, now, REMINDER_KINDS.test);
    await updateActionBadge(nextState, snapshot.settings, now);
    return buildStatus(nextState, snapshot.settings, now);
  });
}

function parseStrictInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function handleMessage(message) {
  switch (message?.type) {
    case MESSAGE_TYPES.getStatus:
      return (async () => {
        const now = Date.now();
        const snapshot = await loadSnapshot(now, { persistIfMissing: false });
        return buildStatus(snapshot.state, snapshot.settings, now);
      })();
    case MESSAGE_TYPES.saveSettings:
      return handleSaveSettings(message.settings);
    case MESSAGE_TYPES.pause:
      return handlePause();
    case MESSAGE_TYPES.resume:
      return handleResume();
    case MESSAGE_TYPES.snooze: {
      return handleSnooze(parseStrictInteger(message.minutes, NaN));
    }
    case MESSAGE_TYPES.startBreak:
      return handleStartBreak();
    case MESSAGE_TYPES.endBreak:
      return handleEndBreak();
    case MESSAGE_TYPES.skip:
      return handleSkip();
    case MESSAGE_TYPES.testReminder:
      return handleTestReminder();
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}

globalThis.chrome.runtime.onInstalled.addListener(() => {
  return (async () => {
    await persistInitialSnapshotIfNeeded(Date.now());
    await reconcileRuntime({ openDueReminder: true });
  })().catch((error) => {
    console.error("[onInstalled] bootstrapRuntime failed:", error);
  });
});

globalThis.chrome.runtime.onStartup.addListener(() => {
  return (async () => {
    await persistInitialSnapshotIfNeeded(Date.now());
    await reconcileRuntime({ openDueReminder: true });
  })().catch((error) => {
    console.error("[onStartup] bootstrapRuntime failed:", error);
  });
});

globalThis.chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAIN_ALARM) {
    return reconcileRuntime({ openDueReminder: true }).catch((error) => {
      console.error("[onAlarm] reconcileRuntime failed:", error);
    });
  }

  if (alarm.name === BADGE_TICK_ALARM) {
    return reconcileRuntime({ openDueReminder: false, isBadgeTick: true }).catch((error) => {
      console.error("[onAlarm:badgeTick] reconcileRuntime failed:", error);
    });
  }
});

globalThis.chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === NOTIFICATION_ID) {
    void globalThis.chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});
    return reconcileRuntime({ openDueReminder: true }).catch((error) => {
      console.error("[notifications.onClicked] reconcileRuntime failed:", error);
    });
  }
});

globalThis.chrome.tabs.onRemoved.addListener((tabId) => {
  void withStateLock(async () => {
    const now = Date.now();
    const snapshot = await loadSnapshot(now);
    if (snapshot.state.notificationTabId !== tabId) {
      return;
    }

    const inSchedule = isWithinSchedule(snapshot.settings, now);
    const wasDue = snapshot.state.reminderKind === REMINDER_KINDS.due;
    const nextState = resetRuntimeState(snapshot.state);

    if (!inSchedule) {
      const nextScheduleStart = getNextScheduleStartTime(snapshot.settings, now);
      await scheduleMainAlarm(nextScheduleStart);
      if (nextState.mode !== MODES.paused) {
        Object.assign(nextState, createInitialState(nextScheduleStart, snapshot.settings));
      }
    } else if (wasDue && isSessionDue(nextState, now)) {
      const fallbackMinutes = snapshot.settings.snoozeMinutesOptions?.[0] || 5;
      nextState.snoozedUntil = now + fallbackMinutes * 60 * 1000;
      await scheduleMainAlarm(nextState.snoozedUntil);
    }

    await writeState(nextState, snapshot.settings);
    await globalThis.chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});
    await updateActionBadge(nextState, snapshot.settings, now);
  }).catch((error) => {
    console.error("[tabs.onRemoved] state cleanup failed:", error);
  });
});

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      const response = await handleMessage(message);
      sendResponse({ ok: true, data: response });
    } catch (error) {
      try {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } catch (sendError) {
        console.warn("[onMessage] sendResponse failed (port likely closed):", sendError);
      }
    }
  })();

  return true;
});
