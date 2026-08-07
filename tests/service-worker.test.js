import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  MODES,
  MESSAGE_TYPES,
  STORAGE_KEYS
} from "../src/shared/constants.js";

// --- Mock infrastructure ---

const syncStore = {};
const localStore = {};
const captured = {
  onMessage: null,
  onTabRemoved: null,
  alarmsCreated: [],
  bootstrapCount: 0,
  onAlarm: null
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
      create: async () => "notif",
      clear: async () => true,
      onClicked: { addListener: () => {} }
    },
    runtime: {
      getURL: (p) => `chrome-extension://fake/${p}`,
      onMessage: { addListener: (fn) => { captured.onMessage = fn; } },
      onInstalled: { addListener: (fn) => { /* 不自动调用，避免 bootstrap 计数干扰 */ } },
      onStartup: { addListener: () => {} }
    },
    windows: { update: async () => ({}) }
  };

  await import("../src/background/service-worker.js");
  // bootstrapRuntime 是 fire-and-forget，等它结束
  await new Promise((r) => setTimeout(r, 200));
});

beforeEach(() => {
  resetStorage();
  captured.alarmsCreated = [];
});

// ------------------------------------------------------------------
// #1 CRITICAL: canEndBreak / canStartBreak 判定逻辑
// ------------------------------------------------------------------

describe("canEndBreak / canStartBreak conditions", () => {
  it("canEndBreak should be true in break mode even without open notification tab", { timeout: 3000 }, async () => {
    const now = Date.now();
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.shortBreak,
      currentSessionStart: now,
      currentSessionEnd: now + 5 * 60 * 1000,
      // 关键：休息模式下不弹提醒页，所以 notificationOpen 为 false
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
      // 提醒页已被用户关闭
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
// #3 HIGH: snoozedUntil 暂停恢复后残留
// ------------------------------------------------------------------

describe("snoozedUntil cleared on pause/resume", () => {
  it("handleResume should clear snoozedUntil", { timeout: 3000 }, async () => {
    const now = Date.now();
    // 模拟已贪睡并暂停的状态
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
// #4 MEDIUM: preserveSessionEnd 阻塞 saveSettings
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
// #5 MEDIUM: scheduleMainAlarm NaN 防护
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

    // 传入非法 minutes，服务端应容错而非抛 TypeError
    const res = await sendMessage({
      type: MESSAGE_TYPES.snooze,
      minutes: "not_a_number"
    });
    assert.equal(res.ok, true, `snooze with invalid minutes should not crash: ${JSON.stringify(res)}`);
  });
});

// ------------------------------------------------------------------
// handleSkip 基础测试（已有，保留）
// ------------------------------------------------------------------

describe("handleSkip", () => {
  it("should schedule next alarm at work duration, not break countdown", { timeout: 3000 }, async () => {
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
    const breakCooldown = DEFAULT_SETTINGS.breakCountdownSeconds * 1000;

    assert.ok(
      delay > breakCooldown,
      `skip should schedule alarm at work duration (~${DEFAULT_SETTINGS.workMinutes}min), ` +
      `got ~${Math.round(delay / 1000)}s (break countdown = ${DEFAULT_SETTINGS.breakCountdownSeconds}s)`
    );
  });

  it("should reset currentSessionEnd to a future timestamp", { timeout: 3000 }, async () => {
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

    await sendMessage({ type: MESSAGE_TYPES.skip });

    const state = localStore[STORAGE_KEYS.state];
    assert.ok(
      state.currentSessionEnd > now,
      `currentSessionEnd should be in the future after skip, got ${state.currentSessionEnd} (now: ${now})`
    );
  });
});

// ------------------------------------------------------------------
// tabs.onRemoved 基础行为测试
// ------------------------------------------------------------------

describe("tabs.onRemoved", () => {
  it("should clear notification state when reminder tab is closed", { timeout: 3000 }, async () => {
    const tabId = 42;
    localStore[STORAGE_KEYS.state] = {
      ...DEFAULT_STATE,
      mode: MODES.work,
      currentSessionStart: Date.now(),
      currentSessionEnd: Date.now() + 30 * 60 * 1000,
      notificationOpen: true,
      notificationTabId: tabId,
      reminderKind: "due"
    };

    captured.onTabRemoved(tabId);
    await new Promise((r) => setTimeout(r, 300));

    const state = localStore[STORAGE_KEYS.state];
    assert.equal(state.notificationOpen, false, "notificationOpen should be false");
    assert.equal(state.notificationTabId, null, "notificationTabId should be null");
    assert.equal(state.reminderKind, null, "reminderKind should be null");
  });
});

// ------------------------------------------------------------------
// 死锁测试放在最后
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
