# Time Reminder Chrome Extension Design

For the execution agent: implement only after the user explicitly approves the follow-up implementation plan. Do not expand scope beyond this document without returning to the architect.

## Goal

Build a Chrome extension that reminds the user to stand up, move, or drink water after focused work. The extension must support configurable work intervals, short and long breaks, reminder auto-close duration, and break countdown duration. The first release should be a complete usable loop rather than a partial demo.

## Architecture

- Platform: Chrome Extension using Manifest V3
- Background orchestration: `service worker`
- Scheduling: `chrome.alarms`
- Persistent settings: `chrome.storage.sync`
- Runtime state: `chrome.storage.local`
- Reminder delivery: system notification plus a dedicated extension reminder page
- User surfaces:
  - Settings page
  - Toolbar popup status page
  - Reminder page for active break actions

## Tech Stack

- TypeScript
- Vite
- Chrome Extensions Manifest V3 APIs
- Minimal CSS without external UI framework for the first release
- Vitest for logic-level tests

## Confirmed Scope

- Primary reminder mode: system notification + extension reminder page
- Two independent durations:
  - reminder page auto-close duration
  - break countdown duration
- Default cadence:
  - work: 45 minutes
  - short break: 5 minutes
  - long break: 15 minutes
  - long break after every 4 short breaks
- First-release auxiliary features:
  - master enable switch
  - snooze for 5 or 10 minutes
  - state recovery after browser restart
  - current cycle status display
  - configuration validation
  - default health reminder copy

## Candidate Options Reviewed

### Option A

System notification + settings page only.

- Pros: smallest implementation
- Cons: weak interaction model, poor break countdown experience

### Option B

System notification + reminder page + settings page + status popup.

- Pros: complete interaction loop, matches user goals, moderate complexity
- Cons: more implementation than a notification-only approach

### Option C

Option B plus advanced schedules, site rules, and history.

- Pros: stronger customization
- Cons: too large for the first release

## Recommended Option

Option B.

## Data Model

### UserSettings

- `enabled`
- `workMinutes`
- `shortBreakMinutes`
- `longBreakMinutes`
- `longBreakEvery`
- `notificationAutoCloseSeconds`
- `breakAutoCloseSeconds`
- `snoozeMinutesOptions`
- `reminderTitle`
- `reminderBody`

### TimerState

- `mode`: `work | shortBreak | longBreak | paused`
- `cycleCount`
- `currentSessionStart`
- `currentSessionEnd`
- `lastReminderAt`
- `snoozedUntil`
- `notificationOpen`
- `previousMode` for pause/resume recovery

### TimerAction

- `START`
- `PAUSE`
- `RESUME`
- `SKIP`
- `SNOOZE_5`
- `SNOOZE_10`
- `BEGIN_BREAK`
- `END_BREAK`
- `DISMISS`

## Interaction Flow

### Options Page

- Edit cadence and display settings
- Save settings and apply immediately
- Restore defaults
- Trigger a test reminder

### Popup Page

- Show current mode
- Show remaining time
- Show progress toward next long break
- Allow pause/resume
- Allow quick jump to settings
- Allow test reminder

### Reminder Page

- Show current reminder type
- Show break countdown
- Allow:
  - start break
  - snooze 5 minutes
  - snooze 10 minutes
  - skip current reminder
- Auto-close after configured duration without losing background state

## State Machine

- `work` -> when work timer completes -> `shortBreak` or `longBreak`
- `shortBreak` -> when break ends -> `work`
- `longBreak` -> when break ends -> `work` and reset `cycleCount`
- `paused` -> when resumed -> restore previous mode
- any active state -> when snoozed -> keep mode but shift effective reminder trigger time

## Rules and Constraints

- Only one reminder page may be open at a time
- Closing the reminder page does not disable reminders
- Snooze affects the current reminder only
- Browser restart must restore state from persisted data
- Runtime state and user settings must be stored separately
- Timing logic must be centralized in one engine module

## Risks

- MV3 service worker lifecycle can cause timing drift if state recovery is weak
- Notification behavior differs by platform
- Reminder UI must avoid duplicate windows or repeated triggers
- Scope expansion is the main product risk for the first release

## Success Criteria

- The unpacked extension can be loaded successfully
- Settings persist across browser restarts
- Work sessions reliably trigger reminders
- Long breaks occur after the configured number of short breaks
- Snooze and skip actions behave predictably
- The user can tell current state and remaining time from the popup
