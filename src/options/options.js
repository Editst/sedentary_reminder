import { DEFAULT_SETTINGS, MESSAGE_TYPES } from "../shared/constants.js";

const form = document.querySelector("#settings-form");
const statusEl = document.querySelector("#status");
const elements = {
  enabled: document.querySelector("#enabled"),
  workMinutes: document.querySelector("#workMinutes"),
  shortBreakMinutes: document.querySelector("#shortBreakMinutes"),
  longBreakMinutes: document.querySelector("#longBreakMinutes"),
  longBreakEvery: document.querySelector("#longBreakEvery"),
  reminderAutoCloseSeconds: document.querySelector("#reminderAutoCloseSeconds"),
  breakCountdownSeconds: document.querySelector("#breakCountdownSeconds"),
  snoozeMinutesOptions: document.querySelector("#snoozeMinutesOptions"),
  reminderTitle: document.querySelector("#reminderTitle"),
  reminderBody: document.querySelector("#reminderBody")
};

function setStatus(message) {
  statusEl.textContent = message;
}

function serializeForm() {
  return {
    enabled: elements.enabled.checked,
    workMinutes: Number(elements.workMinutes.value),
    shortBreakMinutes: Number(elements.shortBreakMinutes.value),
    longBreakMinutes: Number(elements.longBreakMinutes.value),
    longBreakEvery: Number(elements.longBreakEvery.value),
    reminderAutoCloseSeconds: Number(elements.reminderAutoCloseSeconds.value),
    breakCountdownSeconds: Number(elements.breakCountdownSeconds.value),
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
  elements.workMinutes.value = settings.workMinutes;
  elements.shortBreakMinutes.value = settings.shortBreakMinutes;
  elements.longBreakMinutes.value = settings.longBreakMinutes;
  elements.longBreakEvery.value = settings.longBreakEvery;
  elements.reminderAutoCloseSeconds.value = settings.reminderAutoCloseSeconds;
  elements.breakCountdownSeconds.value = settings.breakCountdownSeconds;
  elements.snoozeMinutesOptions.value = settings.snoozeMinutesOptions.join(", ");
  elements.reminderTitle.value = settings.reminderTitle;
  elements.reminderBody.value = settings.reminderBody;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "未知错误"));
        return;
      }

      resolve(response.data);
    });
  });
}

function formatStatus(snapshot) {
  if (!snapshot.enabled) {
    return "提醒已关闭，后台不会继续调度通知和提醒页。";
  }

  return `当前状态：${snapshot.modeLabel}，剩余约 ${Math.ceil(snapshot.remainingMs / 1000)} 秒。`;
}

async function init() {
  populateForm(DEFAULT_SETTINGS);
  try {
    const snapshot = await sendMessage({ type: MESSAGE_TYPES.getStatus });
    populateForm(snapshot.settings);
    setStatus(formatStatus(snapshot));
  } catch (error) {
    setStatus(`读取当前状态失败：${error.message}`);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("正在保存设置...");
  try {
    const snapshot = await sendMessage({ type: MESSAGE_TYPES.saveSettings, settings: serializeForm() });
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
    const snapshot = await sendMessage({ type: MESSAGE_TYPES.saveSettings, settings: DEFAULT_SETTINGS });
    populateForm(snapshot.settings);
    setStatus(`已恢复默认设置。${formatStatus(snapshot)}`);
  } catch (error) {
    setStatus(`恢复默认设置失败：${error.message}`);
  }
});

document.querySelector("#test").addEventListener("click", async () => {
  setStatus("正在发送测试提醒...");
  try {
    const snapshot = await sendMessage({ type: MESSAGE_TYPES.testReminder });
    setStatus(snapshot.reminderVisible ? "测试提醒已打开；如窗口已存在，则已自动聚焦。" : formatStatus(snapshot));
  } catch (error) {
    setStatus(`测试提醒失败：${error.message}`);
  }
});

await init();
