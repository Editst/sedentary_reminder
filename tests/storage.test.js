import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeState } from "../src/shared/storage.js";
import { DEFAULT_STATE, MODES } from "../src/shared/constants.js";

describe("normalizeState", () => {
  it("should return valid defaults for empty input", () => {
    const now = 1000000;
    const state = normalizeState({}, now);
    assert.equal(state.mode, MODES.work);
    assert.equal(state.cycleCount, 0);
    assert.equal(state.notificationOpen, false);
    assert.equal(state.notificationTabId, null);
    assert.equal(state.reminderKind, null);
    assert.equal(state.currentSessionStart, now);
    assert.ok(state.currentSessionEnd > now);
  });

  it("should strip unknown and malformed properties", () => {
    const raw = {
      ...DEFAULT_STATE,
      unknownProp: "garbage",
      maliciousField: 12345,
      notificationTabId: "invalid_id",
      reminderKind: "not_a_valid_kind"
    };

    const state = normalizeState(raw);
    assert.equal("unknownProp" in state, false, "should strip unknownProp");
    assert.equal("maliciousField" in state, false, "should strip maliciousField");
    assert.equal(state.notificationTabId, null, "should sanitize invalid notificationTabId");
    assert.equal(state.reminderKind, null, "should sanitize invalid reminderKind");
  });

  it("should preserve valid preserveSessionEnd and pausedRemainingMs", () => {
    const raw = {
      ...DEFAULT_STATE,
      preserveSessionEnd: true,
      pausedRemainingMs: 50000
    };

    const state = normalizeState(raw);
    assert.equal(state.preserveSessionEnd, true);
    assert.equal(state.pausedRemainingMs, 50000);
  });

  it("should handle null or undefined settings gracefully without throwing", () => {
    const state = normalizeState({}, 1000, null);
    assert.equal(state.mode, MODES.work);
    assert.ok(state.currentSessionEnd > 1000);
  });
});
