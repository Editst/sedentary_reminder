export const STORAGE_KEYS = {
  settings: "timeReminder.settings",
  state: "timeReminder.state"
};

export const MODES = {
  work: "work",
  shortBreak: "shortBreak",
  longBreak: "longBreak",
  paused: "paused"
};

export const RESUMABLE_MODES = [MODES.work, MODES.shortBreak, MODES.longBreak];

export const MESSAGE_TYPES = {
  getStatus: "GET_STATUS",
  saveSettings: "SAVE_SETTINGS",
  pause: "PAUSE",
  resume: "RESUME",
  snooze: "SNOOZE",
  skip: "SKIP",
  startBreak: "START_BREAK",
  endBreak: "END_BREAK",
  testReminder: "TEST_REMINDER"
};

export const MAIN_ALARM = "time-reminder-main-alarm";
export const NOTIFICATION_ID = "time-reminder-notification";

export const REMINDER_KINDS = {
  due: "due",
  test: "test"
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  workMinutes: 45,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  reminderAutoCloseSeconds: 30,
  snoozeMinutesOptions: [5, 10],
  reminderTitle: "该起身活动了",
  reminderBody: "站起来走一走，伸展一下，顺手喝点水。",
  scheduleEnabled: false,
  scheduleStartTime: "09:00",
  scheduleEndTime: "18:00",
  scheduleDays: [1, 2, 3, 4, 5]
};

export const DEFAULT_STATE = {
  mode: MODES.work,
  cycleCount: 0,
  currentSessionStart: 0,
  currentSessionEnd: 0,
  lastReminderAt: 0,
  snoozedUntil: 0,
  notificationOpen: false,
  previousMode: MODES.work,
  notificationTabId: null,
  reminderKind: null
};
