# Time Reminder Chrome Extension Implementation Plan

For the execution agent: execute this plan in order, keep changes within the listed files, and stop to report back if the discovered codebase structure diverges from the assumptions below. Organize implementation in TDD order where practical: write a failing test for pure logic first, confirm failure, implement the smallest change, then verify the passing result.

## Goal

Implement a Chrome extension from scratch in this repository that delivers configurable work reminders, short and long breaks, reminder-page auto-close timing, and break countdown timing, with a usable settings flow and runtime recovery.

## Architecture

- Manifest V3 Chrome extension
- Background scheduler in a service worker
- Logic centralized in a timer engine
- `chrome.storage.sync` for user settings
- `chrome.storage.local` for runtime state
- Three UI surfaces:
  - options page
  - popup status page
  - reminder page

## Tech Stack

- TypeScript
- Vite
- Vitest
- Native Chrome Extension APIs
- Plain CSS

## Assumptions

- Repository is currently empty and greenfield
- No existing code or assets need to be preserved
- The user has approved the documented design and default cadence

## Files To Create

| File | Responsibility |
|---|---|
| `package.json` | Scripts and dependencies |
| `tsconfig.json` | TypeScript compiler configuration |
| `vite.config.ts` | Build config for extension pages and assets |
| `manifest.json` | Extension manifest and entry wiring |
| `src/lib/types.ts` | Shared types for settings, state, actions |
| `src/lib/constants.ts` | Defaults, action names, storage keys |
| `src/lib/storage.ts` | Read/write helpers for settings and runtime state |
| `src/lib/timer-engine.ts` | Pure timing and mode transition logic |
| `src/lib/validation.ts` | Settings normalization and validation |
| `src/background/service-worker.ts` | Alarm handling, notifications, state orchestration |
| `src/options/index.html` | Settings page shell |
| `src/options/main.ts` | Settings form behavior |
| `src/options/options.css` | Settings page styling |
| `src/popup/index.html` | Popup page shell |
| `src/popup/main.ts` | Runtime status rendering and quick actions |
| `src/popup/popup.css` | Popup styling |
| `src/notification/index.html` | Reminder page shell |
| `src/notification/main.ts` | Reminder interactions and countdown display |
| `src/notification/notification.css` | Reminder page styling |
| `src/assets/icons/*` | Placeholder extension icons |
| `tests/timer-engine.test.ts` | Core transition tests |
| `tests/validation.test.ts` | Validation and normalization tests |
| `README.md` | Install and usage documentation |

## Dependencies and Order

1. Project config and build scripts must exist before extension code can compile
2. Shared types and constants must exist before storage and timer logic
3. Validation and storage must exist before UI forms and background orchestration
4. Timer engine must be in place before service worker behavior
5. Background events must be wired before popup and reminder interactions can be verified

## Task Breakdown

### Phase 1: Project Setup

1. Create `package.json` with `dev`, `build`, and `test` scripts
2. Create `tsconfig.json`
3. Create `vite.config.ts`
4. Create `manifest.json`
5. Add placeholder icon files or clearly documented temporary icon handling

### Phase 2: Shared Model and Tests

1. Create `src/lib/types.ts`
2. Create `src/lib/constants.ts`
3. Create failing `tests/validation.test.ts`
4. Implement `src/lib/validation.ts`
5. Run tests and confirm validation passes
6. Create failing `tests/timer-engine.test.ts`
7. Implement `src/lib/timer-engine.ts`
8. Run tests and confirm timer logic passes

### Phase 3: Persistence Layer

1. Implement `src/lib/storage.ts`
2. Add settings initialization and default-state bootstrap helpers
3. Verify settings and runtime state separation

### Phase 4: Background Scheduler

1. Implement `src/background/service-worker.ts`
2. Wire alarm creation and rescheduling
3. Wire notification creation
4. Wire reminder-page open logic with duplicate-open protection
5. Wire pause, resume, snooze, skip, and break-complete flows

### Phase 5: UI Surfaces

1. Implement `src/options/index.html`, `src/options/main.ts`, `src/options/options.css`
2. Implement `src/popup/index.html`, `src/popup/main.ts`, `src/popup/popup.css`
3. Implement `src/notification/index.html`, `src/notification/main.ts`, `src/notification/notification.css`
4. Verify UI actions send the correct extension messages

### Phase 6: Documentation and Verification

1. Write `README.md`
2. Run test suite
3. Run production build
4. Manually verify unpacked extension load path and runtime behavior
5. Hand off to reviewer

## Test Strategy

- Unit tests:
  - settings validation and normalization
  - timer transitions
  - long-break threshold behavior
  - snooze behavior
- Manual verification:
  - load unpacked extension
  - save settings and reload browser
  - observe reminder trigger
  - verify only one reminder page opens
  - verify long break scheduling after threshold
  - verify snooze and skip flows

## Key Decisions

- Use `chrome.storage.sync` for durable user preferences
- Use `chrome.storage.local` for mutable runtime state
- Use a dedicated reminder page instead of notifications alone
- Keep timing rules in a pure module to make logic testable
- Keep first release framework-light to reduce complexity

## Risks and Watchpoints

- Alarm timing in MV3 is not exact to the second
- Reminder-page window management can become inconsistent without explicit open-state tracking
- Browser restart recovery needs careful handling of stale timestamps
- Placeholder icons may need replacement before distribution

## Out of Scope For This Iteration

- User accounts or cloud sync beyond Chrome sync storage
- Site-specific behavior rules
- Workday schedules
- Historical analytics
- Multi-language support

## Execution Mode Options

After plan approval, execution can proceed in one of two ways:

1. Current-session execution
   - The current team implements and reviews the plan in this session
2. Subagent execution
   - The plan is delegated in slices to implementation agents and then reviewed

Current recommendation: current-session execution, because the project is greenfield and tightly coupled in the first iteration.
