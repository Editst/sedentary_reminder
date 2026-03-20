# Time Reminder

Chrome MV3 reminder extension for focused work and healthy breaks.

## What it does

- Tracks work sessions and switches between work, short break, and long break modes
- Shows a system notification and a dedicated reminder page when a break is due
- Supports pause, resume, snooze for 5 or 10 minutes, skip, and a test reminder
- Persists settings in `chrome.storage.sync` and runtime state in `chrome.storage.local`
- Exposes a popup for quick status checks and an options page for configuration

## Load as unpacked extension

1. Open Chrome and go to `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select the repository root directory: `D:\Documents\time_reminder`

The manifest points directly at the files under `src/`, so no build step is required for local use.

## Settings

- Work minutes
- Short break minutes
- Long break minutes
- Long break cadence
- Reminder auto-close seconds
- Break countdown seconds
- Snooze options
- Reminder title and body

## Scripts

- `npm test` - run the Vitest suite
- `npm run build` - prints a note that the extension can be loaded unpacked from the repo root

## File layout

- `src/background/service-worker.js` - runtime orchestration
- `src/shared/*` - constants, validation, storage, and timer logic
- `src/options/*` - settings page
- `src/popup/*` - status popup
- `src/notification/*` - reminder page
