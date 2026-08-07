import { DEFAULT_SETTINGS, MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants.js";
import { sendExtensionMessage } from "../shared/messaging.js";

const form = document.querySelector("#settings-form");
const statusEl = document.querySelector("#status");
const scheduleDetails = document.querySelector("#schedule-details");

const elements = {
  enabled: document.querySelector("#enabled"),
  scheduleEnabled: document.querySelector("#scheduleEnabled"),
  scheduleStartTime: document.querySelector("#scheduleStartTime"),
  scheduleEndTime: document.querySelector("#scheduleEndTime"),
  workMinutes: document.querySelector("#workMinutes"),
  shortBreakMinutes: document.querySelector("#shortBreakMinutes"),
  longBreakMinutes: document.querySelector("#longBreakMinutes"),
  longBreakEvery: document.querySelector("#longBreakEvery"),
  reminderAutoCloseSeconds: document.querySelector("#reminderAutoCloseSeconds"),
  snoozeMinutesOptions: document.querySelector("#snoozeMinutesOptions"),
  reminderTitle: document.querySelector("#reminderTitle"),
  reminderBody: document.querySelector("#reminderBody")
};

function setStatus(message) {
  statusEl.textContent = message;
}

function updateScheduleVisibility() {
  if (scheduleDetails) {
    scheduleDetails.style.display = elements.scheduleEnabled.checked ? "grid" : "none";
  }
}

function getSelectedDays() {
  const checkedBoxes = document.querySelectorAll('input[name="scheduleDay"]:checked');
  const days = Array.from(checkedBoxes).map((item) => Number.parseInt(item.value, 10));
  return days.length > 0 ? days : [1, 2, 3, 4, 5];
}

function setSelectedDays(days = [1, 2, 3, 4, 5]) {
  const daySet = new Set(Array.isArray(days) ? days : [1, 2, 3, 4, 5]);
  const checkboxes = document.querySelectorAll('input[name="scheduleDay"]');
  checkboxes.forEach((cb) => {
    cb.checked = daySet.has(Number.parseInt(cb.value, 10));
  });
}

function serializeForm() {
  return {
    enabled: elements.enabled.checked,
    scheduleEnabled: elements.scheduleEnabled.checked,
    scheduleStartTime: elements.scheduleStartTime.value || "09:00",
    scheduleEndTime: elements.scheduleEndTime.value || "18:00",
    scheduleDays: getSelectedDays(),
    workMinutes: Number(elements.workMinutes.value),
    shortBreakMinutes: Number(elements.shortBreakMinutes.value),
    longBreakMinutes: Number(elements.longBreakMinutes.value),
    longBreakEvery: Number(elements.longBreakEvery.value),
    reminderAutoCloseSeconds: Number(elements.reminderAutoCloseSeconds.value),
    snoozeMinutesOptions: elements.snoozeMinutesOptions.value
      .split(",")
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isInteger(item)),
    reminderTitle: elements.reminderTitle.value,
    reminderBody: elements.reminderBody.value
  };
}

function populateForm(settings) {
  elements.enabled.checked = Boolean(settings.enabled);
  elements.scheduleEnabled.checked = Boolean(settings.scheduleEnabled);
  elements.scheduleStartTime.value = settings.scheduleStartTime || "09:00";
  elements.scheduleEndTime.value = settings.scheduleEndTime || "18:00";
  setSelectedDays(settings.scheduleDays);
  elements.workMinutes.value = settings.workMinutes;
  elements.shortBreakMinutes.value = settings.shortBreakMinutes;
  elements.longBreakMinutes.value = settings.longBreakMinutes;
  elements.longBreakEvery.value = settings.longBreakEvery;
  elements.reminderAutoCloseSeconds.value = settings.reminderAutoCloseSeconds;
  elements.snoozeMinutesOptions.value = settings.snoozeMinutesOptions.join(", ");
  elements.reminderTitle.value = settings.reminderTitle;
  elements.reminderBody.value = settings.reminderBody;
  updateScheduleVisibility();
}

function formatStatus(snapshot) {
  if (!snapshot.enabled) {
    return "提醒已关闭，后台不会继续调度通知和提醒页。";
  }

  if (snapshot.inSchedule === false) {
    const nextDate = new Date(snapshot.nextScheduleStart);
    const timeStr = `${String(nextDate.getHours()).padStart(2, "0")}:${String(nextDate.getMinutes()).padStart(2, "0")}`;
    return `当前处于非生效时段（将于 ${timeStr} 自动恢复调度）。`;
  }

  return `当前状态：${snapshot.modeLabel}，剩余约 ${Math.ceil(snapshot.remainingMs / 1000)} 秒。`;
}

async function init() {
  populateForm(DEFAULT_SETTINGS);
  elements.scheduleEnabled.addEventListener("change", updateScheduleVisibility);

  try {
    const snapshot = await sendExtensionMessage({ type: MESSAGE_TYPES.getStatus });
    populateForm(snapshot.settings);
    setStatus(formatStatus(snapshot));
  } catch (error) {
    setStatus(`读取当前状态失败：${error.message}`);
  }

  if (globalThis.chrome?.storage?.onChanged) {
    globalThis.chrome.storage.onChanged.addListener((changes) => {
      if (changes[STORAGE_KEYS.settings]?.newValue) {
        populateForm(changes[STORAGE_KEYS.settings].newValue);
      }
    });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("正在保存设置...");
  try {
    const snapshot = await sendExtensionMessage({ type: MESSAGE_TYPES.saveSettings, settings: serializeForm() });
    populateForm(snapshot.settings);
    setStatus(snapshot.enabled ? "设置已保存，并已立即应用。" : "设置已保存，提醒已关闭。");
  } catch (error) {
    setStatus(`保存失败：${error.message}`);
  }
});

document.querySelector("#reset").addEventListener("click", async () => {
  populateForm(DEFAULT_SETTINGS);
  setStatus("正在恢复默认设置...");
  try {
    const snapshot = await sendExtensionMessage({ type: MESSAGE_TYPES.saveSettings, settings: DEFAULT_SETTINGS });
    populateForm(snapshot.settings);
    setStatus(`已恢复默认设置。${formatStatus(snapshot)}`);
  } catch (error) {
    setStatus(`恢复默认设置失败：${error.message}`);
  }
});

document.querySelector("#test").addEventListener("click", async () => {
  setStatus("正在发送测试提醒...");
  try {
    const snapshot = await sendExtensionMessage({ type: MESSAGE_TYPES.testReminder });
    setStatus(snapshot.reminderVisible ? "测试提醒已打开；如窗口已存在，则已自动聚焦。" : formatStatus(snapshot));
  } catch (error) {
    setStatus(`测试提醒失败：${error.message}`);
  }
});

void init();
