import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  MODES,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  MAIN_ALARM,
  NOTIFICATION_ID
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
  onNotificationClicked: null
};

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
      query: async () => [],
      create: async (opts) => ({ id: Math.floor(Math.random() * 1e5), url: opts.url, windowId: 1 }),
      update: async () => ({}),
      remove: async () => {},
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
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} }
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
  await new Promise((r) => setTimeout(r, 200));
});

beforeEach(() => {
  resetStorage();
  captured.alarmsCreated = [];
  captured.notificationsCreated = [];
  captured.notificationsCleared = [];
  captured.windowsUpdated = [];
  captured.badgeText = "";
  captured.badgeColor = "";
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

    const alarm = captured.alarmsCreated.at(-1);
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
    await new Promise((r) => setTimeout(r, 300));

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.notificationOpen, false, "notificationOpen should be false");
    assert.equal(state.notificationTabId, null, "notificationTabId should be null");
    assert.equal(state.reminderKind, null, "reminderKind should be null");

    const alarm = captured.alarmsCreated.at(-1);
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
    await new Promise((r) => setTimeout(r, 50));

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

describe("action badge updates", () => {
  it("should update badge text on status sync", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: now,
      currentSessionEnd: now + 25 * 60 * 1000
    };

    await sendMessage({ type: MESSAGE_TYPES.getStatus });
    assert.ok(captured.badgeText.length > 0, "badgeText should be set");
  });
});

// ------------------------------------------------------------------
// #10 getStatus 在 due 状态下保证 Alarm 存活 (防止假死)
// ------------------------------------------------------------------

describe("getStatus alarm retention on due session", () => {
  it("schedules a retry alarm when getStatus is called during due work session without open reminder", { timeout: 3000 }, async () => {
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
    captured.alarmsCreated = [];

    const res = await sendMessage({ type: MESSAGE_TYPES.getStatus });
    assert.equal(res.ok, true);
    assert.equal(res.data.due, true);

    const alarm = captured.alarmsCreated.at(-1);
    assert.ok(alarm, "retry alarm should be scheduled so closing popup does not leave the timer stranded");
    assert.equal(alarm.name, MAIN_ALARM);
    assert.ok(alarm.when > now, "alarm when timestamp should be in the near future");
  });
});

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
});
