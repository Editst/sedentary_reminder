import { describe, expect, it } from "vitest";
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

describe("timer engine", () => {
  it("creates an initial work session", () => {
    const now = 1000;
    const state = createInitialState(now, settings);
    expect(state.mode).toBe(MODES.work);
    expect(state.currentSessionEnd).toBe(now + 45 * 60 * 1000);
  });

  it("switches to a short break before the threshold", () => {
    const state = createNextBreakState(
      {
        mode: MODES.work,
        cycleCount: 0
      },
      settings,
      1000
    );

    expect(state.mode).toBe(MODES.shortBreak);
    expect(state.cycleCount).toBe(1);
  });

  it("switches to a long break at the threshold", () => {
    const state = createNextBreakState(
      {
        mode: MODES.work,
        cycleCount: 3
      },
      settings,
      1000
    );

    expect(state.mode).toBe(MODES.longBreak);
    expect(state.cycleCount).toBe(0);
  });

  it("returns to work from a break", () => {
    const state = createNextWorkState(
      {
        mode: MODES.shortBreak,
        cycleCount: 1
      },
      settings,
      1000
    );

    expect(state.mode).toBe(MODES.work);
    expect(state.currentSessionEnd).toBe(1000 + 45 * 60 * 1000);
  });

  it("respects a snoozed reminder target", () => {
    const state = applySnooze(
      {
        mode: MODES.work,
        currentSessionEnd: 1000,
        snoozedUntil: 0
      },
      5,
      2000
    );

    expect(isSessionDue(state, 2001)).toBe(false);
    expect(isSessionDue(state, 2000 + 5 * 60 * 1000)).toBe(true);
  });
});
