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
const captured = { onMessage: null, onTabRemoved: null, alarmsCreated: [] };

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
      onAlarm: { addListener: () => {} }
    },
    notifications: {
      create: async () => "notif",
      clear: async () => true,
      onClicked: { addListener: () => {} }
    },
    runtime: {
      getURL: (p) => `chrome-extension://fake/${p}`,
      onMessage: { addListener: (fn) => { captured.onMessage = fn; } },
      onInstalled: { addListener: () => {} },
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
// handleSkip 测试放在前面，因为不会触发死锁
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
// 死锁测试放在最后（一旦死锁，后续所有 withStateLock 调用均阻塞）
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
