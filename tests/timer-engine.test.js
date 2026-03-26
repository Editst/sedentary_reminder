import assert from "node:assert/strict";
import test from "node:test";
import { MODES } from "../src/shared/constants.js";
import {
  applySnooze,
  createInitialState,
  createNextBreakState,
  createNextWorkState,
  isSessionDue
} from "../src/shared/timer_engine.js";

const settings = {
  workMinutes: 45,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4
};

test("creates an initial work session", () => {
  const now = 1000;
  const state = createInitialState(now, settings);
  assert.equal(state.mode, MODES.work);
  assert.equal(state.currentSessionEnd, now + 45 * 60 * 1000);
});

test("switches to a short break before the threshold", () => {
  const state = createNextBreakState(
    {
      mode: MODES.work,
      cycleCount: 0
    },
    settings,
    1000
  );

  assert.equal(state.mode, MODES.shortBreak);
  assert.equal(state.cycleCount, 1);
});

test("switches to a long break at the threshold", () => {
  const state = createNextBreakState(
    {
      mode: MODES.work,
      cycleCount: 3
    },
    settings,
    1000
  );

  assert.equal(state.mode, MODES.longBreak);
  assert.equal(state.cycleCount, 0);
});

test("returns to work from a break", () => {
  const state = createNextWorkState(
    {
      mode: MODES.shortBreak,
      cycleCount: 1
    },
    settings,
    1000
  );

  assert.equal(state.mode, MODES.work);
  assert.equal(state.currentSessionEnd, 1000 + 45 * 60 * 1000);
});

test("respects a snoozed reminder target", () => {
  const state = applySnooze(
    {
      mode: MODES.work,
      currentSessionEnd: 1000,
      snoozedUntil: 0
    },
    5,
    2000
  );

  assert.equal(isSessionDue(state, 2001), false);
  assert.equal(isSessionDue(state, 2000 + 5 * 60 * 1000), true);
});
