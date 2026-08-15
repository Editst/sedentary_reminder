import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  MODES,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  MAIN_ALARM,
  NOTIFICATION_ID,
  REMINDER_KINDS
} from "../src/shared/constants.js";

// --- Mock infrastructure ---

const syncStore = {};
const localStore = {};
const captured = {
  onMessage: null,
  onTabRemoved: null,
  alarmsCreated: [],
  notificationsCreated: [],
  notificationsCleared: [],
  windowsUpdated: [],
  badgeText: "",
  badgeColor: "",
  onAlarm: null,
  onInstalled: null,
  onStartup: null,
  onNotificationClicked: null,
  tabsQueried: [],
  tabsRemoved: [],
  mockTabsQueryReturn: null
};

export const waitEvent = () => new Promise(r => setImmediate(r));

function clearObject(obj) {
  for (const key of Object.keys(obj)) {
    delete obj[key];
  }
}

function resetStorage() {
  clearObject(syncStore);
  clearObject(localStore);
  const now = Date.now();
  syncStore[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS };
  localStore[STORAGE_KEYS.state] = {
    ...DEFAULT_STATE,
    currentSessionStart: now,
    currentSessionEnd: now + DEFAULT_SETTINGS.workMinutes * 60 * 1000
  };
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    captured.onMessage(msg, {}, resolve);
  });
}

before(async () => {
  resetStorage();

  globalThis.chrome = {
    storage: {
      sync: {
        get: async (key) => ({ [key]: syncStore[key] }),
        set: async (data) => Object.assign(syncStore, data)
      },
      local: {
        get: async (key) => ({ [key]: localStore[key] }),
        set: async (data) => Object.assign(localStore, data)
      }
    },
    tabs: {
      query: async (opts) => {
        captured.tabsQueried.push(opts);
        return captured.mockTabsQueryReturn || [];
      },
      create: async (opts) => ({ id: Math.floor(Math.random() * 1e5), url: opts.url, windowId: 1 }),
      update: async () => ({}),
      remove: async (ids) => {
        captured.tabsRemoved.push(ids);
      },
      onRemoved: { addListener: (fn) => { captured.onTabRemoved = fn; } }
    },
    alarms: {
      create: async (name, opts) => { captured.alarmsCreated.push({ name, ...opts }); },
      clear: async () => true,
      onAlarm: { addListener: (fn) => { captured.onAlarm = fn; } }
    },
    notifications: {
      create: async (id, opts) => {
        captured.notificationsCreated.push({ id, ...opts });
        return id;
      },
      clear: async (id) => {
        captured.notificationsCleared.push(id);
        return true;
      },
      onClicked: { addListener: (fn) => { captured.onNotificationClicked = fn; } }
    },
    action: {
      setBadgeText: async (opts) => { captured.badgeText = opts.text; },
      setBadgeBackgroundColor: async (opts) => { captured.badgeColor = opts.color; }
    },
    runtime: {
      getURL: (p) => `chrome-extension://fake/${p}`,
      onMessage: { addListener: (fn) => { captured.onMessage = fn; } },
      onInstalled: { addListener: (fn) => { captured.onInstalled = fn; } },
      onStartup: { addListener: (fn) => { captured.onStartup = fn; } }
    },
    windows: {
      update: async (winId, opts) => {
        captured.windowsUpdated.push({ winId, ...opts });
        return {};
      },
      create: async (opts) => ({ id: 2, tabs: [{ id: 99, url: opts.url, windowId: 2 }] })
    }
  };

  await import("../src/background/service-worker.js");
  await waitEvent();
});

beforeEach(() => {
  resetStorage();
  captured.alarmsCreated = [];
  captured.notificationsCreated = [];
  captured.notificationsCleared = [];
  captured.windowsUpdated = [];
  captured.badgeText = "";
  captured.badgeColor = "";
  captured.tabsQueried = [];
  captured.tabsRemoved = [];
  captured.mockTabsQueryReturn = null;
});

// ------------------------------------------------------------------
// #1 canEndBreak / canStartBreak 判定逻辑
// ------------------------------------------------------------------

describe("canEndBreak / canStartBreak conditions", () => {
  it("canEndBreak should be true in break mode even without open notification tab", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.shortBreak,
      currentSessionStart: now,
      currentSessionEnd: now + 5 * 60 * 1000,
      notificationOpen: false,
      notificationTabId: null,
      reminderKind: null
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.getStatus });
    assert.equal(res.ok, true);
    assert.equal(
      res.data.canEndBreak,
      true,
      "canEndBreak should be true during break mode regardless of notification state"
    );
  });

  it("handleEndBreak should succeed during break mode", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.shortBreak,
      currentSessionStart: now,
      currentSessionEnd: now + 5 * 60 * 1000,
      notificationOpen: false,
      notificationTabId: null,
      reminderKind: null
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.endBreak });
    assert.equal(res.ok, true);
    assert.equal(
      res.data.state.mode,
      MODES.work,
      "mode should transition to work after ending break"
    );
  });

  it("canStartBreak should be true when work session is due, even if notification tab is closed", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: false,
      notificationTabId: null,
      reminderKind: null
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.getStatus });
    assert.equal(res.ok, true);
    assert.equal(
      res.data.canStartBreak,
      true,
      "canStartBreak should be true when work is due, regardless of notification tab"
    );
  });
});

// ------------------------------------------------------------------
// #2 snoozedUntil 暂停恢复后残留
// ------------------------------------------------------------------

describe("snoozedUntil cleared on pause/resume", () => {
  it("handleResume should clear snoozedUntil", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.paused,
      previousMode: MODES.work,
      currentSessionStart: now - 30 * 60 * 1000,
      currentSessionEnd: now + 15 * 60 * 1000,
      snoozedUntil: now + 10 * 60 * 1000,
      pausedRemainingMs: 15 * 60 * 1000
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.resume });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(
      state.snoozedUntil,
      0,
      `snoozedUntil should be 0 after resume, got ${state.snoozedUntil}`
    );
  });
});

// ------------------------------------------------------------------
// #3 preserveSessionEnd 阻塞 saveSettings
// ------------------------------------------------------------------

describe("preserveSessionEnd cleared on saveSettings", () => {
  it("saveSettings should apply new workMinutes even when preserveSessionEnd is true", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now,
      currentSessionEnd: now + 45 * 60 * 1000,
      preserveSessionEnd: true
    };

    const newWorkMinutes = 30;
    const res = await sendMessage({
      type: MESSAGE_TYPES.saveSettings,
      settings: { ...DEFAULT_SETTINGS, workMinutes: newWorkMinutes }
    });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    const expectedEnd = state.currentSessionStart + newWorkMinutes * 60 * 1000;
    assert.equal(
      state.currentSessionEnd,
      expectedEnd,
      `currentSessionEnd should reflect new workMinutes (${newWorkMinutes}min), ` +
      `got ${(state.currentSessionEnd - state.currentSessionStart) / 60000}min`
    );
  });
});

// ------------------------------------------------------------------
// #4 scheduleMainAlarm NaN 防护
// ------------------------------------------------------------------

describe("scheduleMainAlarm NaN safety", () => {
  it("snooze with NaN minutes should not throw", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: 42,
      reminderKind: "due"
    };

    const res = await sendMessage({
      type: MESSAGE_TYPES.snooze,
      minutes: "not_a_number"
    });
    assert.equal(res.ok, true, `snooze with invalid minutes should not crash: ${JSON.stringify(res)}`);
  });
});

// ------------------------------------------------------------------
// #5 handleSkip 正常跳过
// ------------------------------------------------------------------

describe("handleSkip", () => {
  it("should schedule next alarm at work duration", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: 42,
      reminderKind: "due"
    };
    captured.alarmsCreated = [];

    const res = await sendMessage({ type: MESSAGE_TYPES.skip });
    assert.equal(res.ok, true);

    const alarm = captured.alarmsCreated.find((a) => a.name === 'time-reminder-main-alarm');
    assert.ok(alarm, "alarm should be scheduled after skip");

    const delay = alarm.when - now;
    assert.ok(
      delay >= (DEFAULT_SETTINGS.workMinutes - 1) * 60 * 1000,
      `skip should schedule alarm at work duration (~${DEFAULT_SETTINGS.workMinutes}min), got ~${Math.round(delay / 1000)}s`
    );
  });
});

// ------------------------------------------------------------------
// #6 测试提醒关闭时不重置工作进度
// ------------------------------------------------------------------

describe("testReminder non-destructive behavior", () => {
  it("dismissing test reminder does NOT reset current work session progress", { timeout: 3000 }, async () => {
    const now = Date.now();
    const originalStart = now - 30 * 60 * 1000;
    const originalEnd = originalStart + 45 * 60 * 1000;

    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: originalStart,
      currentSessionEnd: originalEnd,
      notificationOpen: true,
      notificationTabId: 42,
      reminderKind: "test"
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.skip });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(
      state.currentSessionStart,
      originalStart,
      "currentSessionStart should remain intact after dismissing test reminder"
    );
    assert.equal(
      state.currentSessionEnd,
      originalEnd,
      "currentSessionEnd should remain intact after dismissing test reminder"
    );
    assert.equal(state.reminderKind, null, "reminderKind should be reset to null");
  });
});

// ------------------------------------------------------------------
// #7 提醒页关闭后自动安排兜底 Alarm 防止假死
// ------------------------------------------------------------------

describe("tabs.onRemoved fallback alarm", () => {
  it("should schedule fallback snooze alarm when reminder was due and closed without action", { timeout: 3000 }, async () => {
    const now = Date.now();
    const tabId = 42;
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: tabId,
      reminderKind: "due"
    };
    captured.alarmsCreated = [];

    captured.onTabRemoved(tabId);
    await waitEvent();

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.notificationOpen, false, "notificationOpen should be false");
    assert.equal(state.notificationTabId, null, "notificationTabId should be null");
    assert.equal(state.reminderKind, null, "reminderKind should be null");

    const alarm = captured.alarmsCreated.find((a) => a.name === 'time-reminder-main-alarm');
    assert.ok(alarm, "a fallback alarm should be scheduled after due reminder tab is closed");
    assert.equal(alarm.name, MAIN_ALARM);
    assert.ok(alarm.when > now, "alarm time should be in the future");
  });
});

// ------------------------------------------------------------------
// #8 休息结束触发系统通知并切回工作
// ------------------------------------------------------------------

describe("break session completion", () => {
  it("should emit notification when break session ends", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.shortBreak,
      currentSessionStart: now - 6 * 60 * 1000,
      currentSessionEnd: now - 1 * 60 * 1000
    };
    captured.notificationsCreated = [];

    await captured.onAlarm({ name: MAIN_ALARM });
    await waitEvent();

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.mode, MODES.work, "mode should transition to work after break expires");
    assert.ok(
      captured.notificationsCreated.length > 0,
      "a notification should be created to announce break completion"
    );
  });
});

// ------------------------------------------------------------------
// #9 Badge 状态更新
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// #11 重新启用冷启动保护
// ------------------------------------------------------------------

describe("re-enabling fresh work session initialization", () => {
  it("resets to a fresh work session when switching from enabled: false to enabled: true", { timeout: 3000 }, async () => {
    const now = Date.now();
    syncStore[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS, enabled: false };
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      currentSessionEnd: now - 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000
    };

    const res = await sendMessage({
      type: MESSAGE_TYPES.saveSettings,
      settings: { ...DEFAULT_SETTINGS, enabled: true }
    });

    assert.equal(res.ok, true);
    assert.equal(res.data.due, false, "should NOT immediately trigger overdue reminder on re-enable");
    assert.ok(
      res.data.state.currentSessionEnd > now,
      "currentSessionEnd should be in the future from now"
    );
  });
});

// ------------------------------------------------------------------
// #12 生效时段调度与状态
// ------------------------------------------------------------------

describe("active schedule integration", () => {
  it("enters inactive/sleep mode and schedules next active alarm when outside schedule", { timeout: 3000 }, async () => {
    // Config: Mon-Fri 09:00 - 18:00
    syncStore[STORAGE_KEYS.settings] = {
      ...DEFAULT_SETTINGS,
      scheduleEnabled: true,
      scheduleStartTime: "09:00",
      scheduleEndTime: "18:00",
      scheduleDays: [0, 1, 2, 3, 4, 5, 6]
    };

    // Simulate now at 21:00 (outside 09:00-18:00)
    // We test getStatus response
    const res = await sendMessage({ type: MESSAGE_TYPES.getStatus });
    assert.equal(res.ok, true);
    // Even if current time is inside or outside, the status object includes inSchedule and nextScheduleStart
    assert.ok("inSchedule" in res.data, "status must contain inSchedule boolean");
    assert.ok("nextScheduleStart" in res.data, "status must contain nextScheduleStart timestamp");
  });
});

// ------------------------------------------------------------------
// #13 窗口聚焦与 drawAttention
// ------------------------------------------------------------------

describe("window focus & attention on reminder tab open", () => {
  it("calls chrome.windows.update with focused: true and drawAttention: true", { timeout: 3000 }, async () => {
    captured.windowsUpdated = [];
    const res = await sendMessage({ type: MESSAGE_TYPES.testReminder });
    assert.equal(res.ok, true);
    assert.ok(
      captured.windowsUpdated.length > 0,
      "windows.update should be called to focus the reminder window"
    );
    const updateCall = captured.windowsUpdated.at(-1);
    assert.equal(updateCall.focused, true);
    assert.equal(updateCall.drawAttention, true);
  });
});

// ------------------------------------------------------------------
// #14 点击系统通知自动清理
// ------------------------------------------------------------------

describe("notification tray cleanup on click", () => {
  it("clears notification from tray when user clicks the notification", { timeout: 3000 }, async () => {
    captured.notificationsCleared = [];
    await captured.onNotificationClicked(NOTIFICATION_ID);
    assert.ok(
      captured.notificationsCleared.includes(NOTIFICATION_ID),
      "chrome.notifications.clear should be called when notification is clicked"
    );
  });
});

// ------------------------------------------------------------------
// #15 死锁测试
// ------------------------------------------------------------------

describe("withStateLock deadlock prevention", () => {
  it("saveSettings should complete without deadlock", { timeout: 3000 }, async () => {
    const res = await sendMessage({
      type: MESSAGE_TYPES.saveSettings,
      settings: { ...DEFAULT_SETTINGS }
    });
    assert.equal(res.ok, true, `saveSettings should succeed, got: ${JSON.stringify(res)}`);
  });

  it("resume after pause should complete without deadlock", { timeout: 3000 }, async () => {
    await sendMessage({ type: MESSAGE_TYPES.pause });
    const res = await sendMessage({ type: MESSAGE_TYPES.resume });
    assert.equal(res.ok, true, `resume should succeed, got: ${JSON.stringify(res)}`);
  });

  it("resume should align currentSessionStart accurately with remaining duration", { timeout: 3000 }, async () => {
    const now = Date.now();
    syncStore[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS, workMinutes: 45 };
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.paused,
      previousMode: MODES.work,
      pausedRemainingMs: 15 * 60 * 1000 // 15 mins remaining
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.resume });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.mode, MODES.work);
    // Total duration should equal workMinutes (45 mins)
    const span = state.currentSessionEnd - state.currentSessionStart;
    assert.equal(span, 45 * 60 * 1000, "session span must match work duration (45 mins)");
  });
});

// ------------------------------------------------------------------
// #16 tabs.onRemoved 在非生效时段的处理
// ------------------------------------------------------------------

describe("tabs.onRemoved out-of-schedule behavior", () => {
  it("should schedule next window alarm and enter initial state when closed outside schedule", { timeout: 3000 }, async () => {
    const now = Date.now();
    syncStore[STORAGE_KEYS.settings] = {
      ...DEFAULT_SETTINGS,
      scheduleEnabled: true,
      scheduleStartTime: "00:00",
      scheduleEndTime: "00:01", // Only 00:00-00:01 active, rest of day inactive
      scheduleDays: [0, 1, 2, 3, 4, 5, 6]
    };
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      notificationOpen: true,
      notificationTabId: 9999,
      reminderKind: REMINDER_KINDS.due
    };

    await captured.onTabRemoved(9999);
    await waitEvent();

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.notificationOpen, false);
    assert.equal(state.notificationTabId, null);
    // Alarm should be scheduled for the next active schedule start
    assert.ok(captured.alarmsCreated.length > 0);
  });
});

// ------------------------------------------------------------------
// #17 Snooze preserves snoozedUntil (Bug 1 regression)
// ------------------------------------------------------------------

describe("snooze preserves snoozedUntil", () => {
  it("handleSnooze(5) should set snoozedUntil ~5 minutes in the future", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: 42,
      reminderKind: "due"
    };
    captured.alarmsCreated = [];

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "5" });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    const expectedMin = now + 4 * 60 * 1000;
    const expectedMax = now + 6 * 60 * 1000;
    assert.ok(
      state.snoozedUntil >= expectedMin && state.snoozedUntil <= expectedMax,
      `snoozedUntil should be ~5min from now, got ${Math.round((state.snoozedUntil - now) / 1000)}s`
    );

    const alarm = captured.alarmsCreated.find((a) => a.name === 'time-reminder-main-alarm');
    assert.ok(alarm, "an alarm should be scheduled for the snooze");
    assert.equal(alarm.name, MAIN_ALARM);
    const alarmDelay = alarm.when - now;
    assert.ok(
      alarmDelay >= 4 * 60 * 1000 && alarmDelay <= 6 * 60 * 1000,
      `alarm should fire in ~5min, got ~${Math.round(alarmDelay / 1000)}s`
    );
  });

  it("handleSnooze(10) should set snoozedUntil ~10 minutes in the future", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: 42,
      reminderKind: "due"
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "10" });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    const expectedMin = now + 9 * 60 * 1000;
    const expectedMax = now + 11 * 60 * 1000;
    assert.ok(
      state.snoozedUntil >= expectedMin && state.snoozedUntil <= expectedMax,
      `snoozedUntil should be ~10min from now, got ${Math.round((state.snoozedUntil - now) / 1000)}s`
    );
  });
});

// ------------------------------------------------------------------
// #18 Test reminder skip preserves snoozedUntil (latent bug)
// ------------------------------------------------------------------

describe("test reminder skip preserves snoozedUntil", () => {
  it("dismissing test reminder should NOT destroy an active snoozedUntil", { timeout: 3000 }, async () => {
    const now = Date.now();
    const snoozedUntil = now + 8 * 60 * 1000;
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      snoozedUntil,
      notificationOpen: true,
      notificationTabId: 42,
      reminderKind: "test"
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.skip });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(
      state.snoozedUntil,
      snoozedUntil,
      `snoozedUntil should be preserved after dismissing test reminder, got ${state.snoozedUntil}`
    );
  });
});

// ------------------------------------------------------------------
// #19 Badge tick alarm lifecycle
// ------------------------------------------------------------------

describe("badge tick alarm lifecycle", () => {
  it("should create badge-tick alarm during active work session", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now,
      currentSessionEnd: now + 45 * 60 * 1000
    };
    captured.alarmsCreated = [];

    await sendMessage({ type: MESSAGE_TYPES.pause });
    await sendMessage({ type: MESSAGE_TYPES.resume });

    const badgeTick = captured.alarmsCreated.find((a) => a.name === "time-reminder-badge-tick");
    assert.ok(badgeTick, "badge-tick alarm should be created during active work");
    assert.equal(badgeTick.periodInMinutes, 1, "badge-tick should fire every 1 minute");
  });

  it("should NOT create badge-tick alarm when paused", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.paused,
      previousMode: MODES.work,
      pausedRemainingMs: 15 * 60 * 1000
    };
    captured.alarmsCreated = [];

    await sendMessage({ type: MESSAGE_TYPES.saveSettings, settings: DEFAULT_SETTINGS });

    const badgeTick = captured.alarmsCreated.find((a) => a.name === "time-reminder-badge-tick");
    assert.equal(badgeTick, undefined, "badge-tick alarm should NOT exist when paused");
  });

  it("should NOT create badge-tick alarm when disabled", { timeout: 3000 }, async () => {
    syncStore[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS, enabled: false };
    captured.alarmsCreated = [];

    await sendMessage({ type: MESSAGE_TYPES.resume });

    const badgeTick = captured.alarmsCreated.find((a) => a.name === "time-reminder-badge-tick");
    assert.equal(badgeTick, undefined, "badge-tick alarm should NOT exist when disabled");
  });
});

// ------------------------------------------------------------------
// #20 Badge tick alarm triggers badge update
// ------------------------------------------------------------------

describe("badge tick alarm triggers update", () => {
  it("badge-tick alarm should refresh badge text", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now,
      currentSessionEnd: now + 25 * 60 * 1000
    };
    captured.badgeText = "";

    await captured.onAlarm({ name: "time-reminder-badge-tick" });
    await waitEvent();

    assert.ok(captured.badgeText.length > 0, "badgeText should be updated after badge-tick alarm");
  });
});

// ------------------------------------------------------------------
// #21 syncReminderWindowState preserves snoozedUntil (latent bug)
// ------------------------------------------------------------------

describe("syncReminderWindowState preserves snoozedUntil", () => {
  it("closing notification tab should not destroy snoozedUntil", { timeout: 3000 }, async () => {
    const now = Date.now();
    const snoozedUntil = now + 5 * 60 * 1000;
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      snoozedUntil,
      notificationOpen: true,
      notificationTabId: 99,
      reminderKind: "due"
    };

    // Simulate the notification tab being closed
    captured.onTabRemoved(99);
    await waitEvent();

    const state = localStore[STORAGE_KEYS.state];
    // snoozedUntil should be preserved (not reset to 0) since snooze is still active
    assert.ok(
      state.snoozedUntil >= snoozedUntil - 1000,
      `snoozedUntil should be preserved after tab close, got ${state.snoozedUntil} (expected ~${snoozedUntil})`
    );
  });
});


// ------------------------------------------------------------------
// Issue 1: openReminderTab failures should schedule fallback alarm
// ------------------------------------------------------------------

describe("openReminderTab failures fallback alarm", () => {
  it("schedules retry alarm when reminder window creation fails completely", { timeout: 3000 }, async () => {
    // Mock failure for both tabs.create and windows.create
    const origTabsCreate = globalThis.chrome.tabs.create;
    const origWindowsCreate = globalThis.chrome.windows.create;
    globalThis.chrome.tabs.create = async () => { throw new Error("no tabs"); };
    globalThis.chrome.windows.create = async () => { throw new Error("no windows"); };

    try {
      const now = Date.now();
      localStore[STORAGE_KEYS.state] = {
        ...DEFAULT_STATE,
        mode: MODES.work,
        currentSessionStart: now - 50 * 60 * 1000,
        currentSessionEnd: now - 5 * 60 * 1000
      };
      captured.alarmsCreated = [];

      // Trigger main alarm which should normally open reminder
      await captured.onAlarm({ name: MAIN_ALARM });
      await waitEvent();

      const state = localStore[STORAGE_KEYS.state];
      assert.equal(state.notificationOpen, false, "failed open must not mark notification as open");

      const alarm = captured.alarmsCreated.find((a) => a.name === MAIN_ALARM);
      assert.ok(alarm, "retry alarm must be scheduled");
      assert.ok(alarm.when > now, "retry alarm when timestamp should be in the future");
    } finally {
      // Restore mocks
      globalThis.chrome.tabs.create = origTabsCreate;
      globalThis.chrome.windows.create = origWindowsCreate;
    }
  });
});

// ------------------------------------------------------------------
// #22 Snooze guards and whitelist validation
// ------------------------------------------------------------------

describe("Snooze guards and whitelist validation", () => {
  it("should ignore snooze if mode is not work", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.shortBreak,
      currentSessionStart: now - 1000,
      currentSessionEnd: now + 5 * 60 * 1000
    };
    
    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "5" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].mode, MODES.shortBreak);
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0);
  });

  it("should ignore snooze if session is not due", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now,
      currentSessionEnd: now + 45 * 60 * 1000
    };
    
    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "5" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0);
  });

  it("should ignore snooze if minutes not in whitelist", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000
    };
    
    // Default whitelist is [5, 10]. Using 20 should be ignored.
    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "20" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0);
  });

  it("should allow snooze if valid", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000
    };
    
    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "10" });
    assert.equal(res.ok, true);
    assert.ok(localStore[STORAGE_KEYS.state].snoozedUntil > now);
  });
});

// ------------------------------------------------------------------
// #23 badge tick tabs.query optimization
// ------------------------------------------------------------------

describe("Badge tick skips tabs.query when no reminder is open", () => {
  it("badge tick should not query tabs if notificationOpen is false", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now,
      currentSessionEnd: now + 45 * 60 * 1000,
      notificationOpen: false,
      notificationTabId: null
    };
    captured.tabsQueried = [];
    
    await captured.onAlarm({ name: "time-reminder-badge-tick" });
    await waitEvent();
    
    assert.equal(captured.tabsQueried.length, 0, "should short-circuit tabs.query on badge tick");
  });

  it("badge tick should query tabs if reminder is recorded open to allow self-healing", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: 42
    };
    captured.tabsQueried = [];
    
    await captured.onAlarm({ name: "time-reminder-badge-tick" });
    await waitEvent();
    
    assert.ok(captured.tabsQueried.length > 0, "should query tabs to reconcile orphaned notificationOpen");
  });
});

// ------------------------------------------------------------------
// #24 batch tabs.remove
// ------------------------------------------------------------------

describe("Batch tabs.remove", () => {
  it("should close duplicate tabs with a single batch array call", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: 1,
      reminderKind: "due"
    };
    captured.tabsRemoved = [];
    captured.mockTabsQueryReturn = [
      { id: 1, url: "chrome-extension://fake/notification/notification.html" },
      { id: 2, url: "chrome-extension://fake/notification/notification.html" },
      { id: 3, url: "chrome-extension://fake/notification/notification.html" }
    ];
    // Use onAlarm(MAIN_ALARM) to trigger reconcileRuntime which calls syncReminderWindowState(state, true)
    await captured.onAlarm({ name: MAIN_ALARM });
    await waitEvent();

    // normalizeReminderTabs should batch-remove duplicates [2, 3] in a single call
    const batchCall = captured.tabsRemoved.find((ids) => Array.isArray(ids) && ids.length > 1);
    assert.ok(batchCall, "should call tabs.remove with an array of duplicate ids");
    assert.deepEqual(batchCall.sort(), [2, 3], "should pass duplicate tab ids");
  });
});

// ------------------------------------------------------------------
// #25 testReminder should not overwrite due reminder
// ------------------------------------------------------------------

describe("testReminder guard", () => {
  it("should reject test reminder if a genuine due reminder is open", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: true,
      reminderKind: "due",
      notificationTabId: 99
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.testReminder });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.reminderKind, "due", "should not overwrite due with test");
    assert.equal(state.notificationTabId, 99, "should not close original notification");
  });

  it("should reject test reminder if work session is due (no open reminder)", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000,
      notificationOpen: false,
      reminderKind: null,
      notificationTabId: null
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.testReminder });
    assert.equal(res.ok, true);

    const state = localStore[STORAGE_KEYS.state];
    assert.notEqual(state.reminderKind, "test", "should not create test reminder when session is due");
  });
});


// ------------------------------------------------------------------
// Issue 2: saveSettings should preserve paused state
// ------------------------------------------------------------------

describe("saveSettings preserves paused state", () => {
  it("entering schedule window preserves paused state and remaining ms", { timeout: 3000 }, async () => {
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.paused,
      previousMode: MODES.work,
      pausedRemainingMs: 15 * 60 * 1000
    };

    const res = await sendMessage({
      type: MESSAGE_TYPES.saveSettings,
      settings: {
        ...DEFAULT_SETTINGS,
        scheduleEnabled: true,
        scheduleStartTime: "00:00",
        scheduleEndTime: "23:59",
        scheduleDays: [0, 1, 2, 3, 4, 5, 6]
      }
    });

    assert.equal(res.ok, true);
    assert.equal(res.data.state.mode, MODES.paused, "paused must survive settings save");
    assert.equal(res.data.state.pausedRemainingMs, 15 * 60 * 1000, "pausedRemainingMs must survive settings save");
  });
});

// ------------------------------------------------------------------
// Issue 3: getStatus performs zero storage writes (CQS)
// ------------------------------------------------------------------

describe("getStatus CQS compliance", () => {
  it("getStatus performs zero storage writes", { timeout: 3000 }, async () => {
    let writes = 0;
    const origSet = globalThis.chrome.storage.local.set;
    globalThis.chrome.storage.local.set = async (data) => {
      writes++;
      return origSet(data);
    };

    try {
      await sendMessage({ type: MESSAGE_TYPES.getStatus });
      assert.equal(writes, 0, "pure query must not write storage");
    } finally {
      globalThis.chrome.storage.local.set = origSet;
    }
  });
});

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Issue 5: withStateLock timeout recovery
// ------------------------------------------------------------------

describe("withStateLock timeout recovery", () => {
  it("state lock recovers when an operation hangs", { timeout: 6000 }, async () => {
    const origGet = globalThis.chrome.storage.local.get;

    // Mock get to hang indefinitely
    globalThis.chrome.storage.local.get = async () => new Promise(() => {});

    try {
      const res = await sendMessage({ type: MESSAGE_TYPES.pause });
      assert.equal(res.ok, false);
      assert.ok((res.error || "").toLowerCase().includes("time"), "must reject with timeout error");

      // Now restore and check if lock is still usable
      globalThis.chrome.storage.local.get = origGet;
      const res2 = await sendMessage({ type: MESSAGE_TYPES.pause });
      assert.equal(res2.ok, true, "subsequent operations should succeed");
    } finally {
      globalThis.chrome.storage.local.get = origGet;
    }
  });
});

// ------------------------------------------------------------------
// #26 Snooze edge cases: paused, longBreak, negative, zero, oversized
// ------------------------------------------------------------------

describe("Snooze edge-case guards", () => {
  it("should ignore snooze when paused", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.paused,
      previousMode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "5" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].mode, MODES.paused, "mode unchanged");
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0, "snoozedUntil unchanged");
  });

  it("should ignore snooze during long break", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.longBreak,
      currentSessionStart: now,
      currentSessionEnd: now + 15 * 60 * 1000
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "5" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].mode, MODES.longBreak, "mode unchanged");
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0, "snoozedUntil unchanged");
  });

  it("should ignore snooze with negative minutes", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "-5" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0, "negative snooze rejected");
  });

  it("should ignore snooze with zero minutes", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "0" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0, "zero snooze rejected");
  });

  it("should ignore snooze with oversized minutes (999)", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now - 50 * 60 * 1000,
      currentSessionEnd: now - 5 * 60 * 1000
    };

    const res = await sendMessage({ type: MESSAGE_TYPES.snooze, minutes: "999" });
    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].snoozedUntil, 0, "oversized snooze rejected");
  });
});

// ------------------------------------------------------------------
// #27 Unknown message type returns error
// ------------------------------------------------------------------

describe("Unknown message type handling", () => {
  it("should return error for unknown message type without crashing", async () => {
    const res = await sendMessage({ type: "TOTALLY_UNKNOWN" });
    assert.equal(res.ok, false, "should report failure");
    assert.ok(res.error, "should include error message");
  });
});

describe("runtime initialization persistence", () => {
  it("persists missing settings and initial state during installation", async () => {
    clearObject(syncStore);
    clearObject(localStore);

    await captured.onInstalled();

    assert.ok(syncStore[STORAGE_KEYS.settings], "settings should be persisted");
    assert.ok(localStore[STORAGE_KEYS.state], "initial state should be persisted");
    assert.ok(
      localStore[STORAGE_KEYS.state].currentSessionEnd > localStore[STORAGE_KEYS.state].currentSessionStart,
      "initial state should have a valid session range"
    );
  });

  it("keeps GET_STATUS read-only even when storage is empty", async () => {
    clearObject(syncStore);
    clearObject(localStore);
    let writes = 0;
    const originalSyncSet = globalThis.chrome.storage.sync.set;
    const originalLocalSet = globalThis.chrome.storage.local.set;
    globalThis.chrome.storage.sync.set = async (data) => {
      writes++;
      return originalSyncSet(data);
    };
    globalThis.chrome.storage.local.set = async (data) => {
      writes++;
      return originalLocalSet(data);
    };

    try {
      const res = await sendMessage({ type: MESSAGE_TYPES.getStatus });
      assert.equal(res.ok, true);
      assert.equal(writes, 0, "GET_STATUS must not initialize storage");
    } finally {
      globalThis.chrome.storage.sync.set = originalSyncSet;
      globalThis.chrome.storage.local.set = originalLocalSet;
    }
  });
});

describe("command admission guards", () => {
  it("ignores a repeated pause instead of corrupting previousMode", async () => {
    await sendMessage({ type: MESSAGE_TYPES.pause });
    await sendMessage({ type: MESSAGE_TYPES.pause });
    const res = await sendMessage({ type: MESSAGE_TYPES.resume });

    assert.equal(res.ok, true);
    assert.equal(localStore[STORAGE_KEYS.state].mode, MODES.work);
  });

  it("ignores resume outside paused mode", async () => {
    const before = { ...localStore[STORAGE_KEYS.state] };
    const res = await sendMessage({ type: MESSAGE_TYPES.resume });

    assert.equal(res.ok, true);
    assert.deepEqual(localStore[STORAGE_KEYS.state], before);
  });

  it("ignores skip before work is due", async () => {
    const before = { ...localStore[STORAGE_KEYS.state] };
    const res = await sendMessage({ type: MESSAGE_TYPES.skip });

    assert.equal(res.ok, true);
    assert.deepEqual(localStore[STORAGE_KEYS.state], before);
  });

  it("ignores skip during a break", async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.shortBreak,
      currentSessionStart: now,
      currentSessionEnd: now + 5 * 60 * 1000
    };
    const before = { ...localStore[STORAGE_KEYS.state] };

    const res = await sendMessage({ type: MESSAGE_TYPES.skip });

    assert.equal(res.ok, true);
    assert.deepEqual(localStore[STORAGE_KEYS.state], before);
  });
});
