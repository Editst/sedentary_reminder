import { MESSAGE_TYPES } from "../shared/constants.js";

const titleEl = document.querySelector("#title");
const messageEl = document.querySelector("#message");
const countdownEl = document.querySelector("#countdown");
const statusEl = document.querySelector("#status");
const startBreakButton = document.querySelector("#start-break");
const snooze5Button = document.querySelector("#snooze-5");
const snooze10Button = document.querySelector("#snooze-10");
const skipButton = document.querySelector("#skip");

let countdownTimer = null;
let closeTimer = null;
let remainingSeconds = 0;

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Unknown error"));
        return;
      }

      resolve(response.data);
    });
  });
}

function formatSeconds(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function tickCountdown() {
  countdownEl.textContent = formatSeconds(Math.max(0, remainingSeconds));
  if (remainingSeconds <= 0) {
    statusEl.textContent = "提醒页已到自动关闭时间。";
    window.close();
    return;
  }

  remainingSeconds -= 1;
}

function startCountdown(seconds) {
  remainingSeconds = Math.max(0, seconds);
  tickCountdown();
  countdownTimer = window.setInterval(tickCountdown, 1000);
}

function clearTimers() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
  }
  if (closeTimer) {
    window.clearTimeout(closeTimer);
  }
}

async function loadState() {
  const snapshot = await sendMessage({ type: MESSAGE_TYPES.getStatus });
  titleEl.textContent = snapshot.state.mode === "work" ? "工作提醒" : "休息提醒";
  messageEl.textContent = snapshot.settings.reminderBody;
  statusEl.textContent = snapshot.reminderVisible ? "提醒已打开。" : "正在显示提醒页。";
  const closeSeconds = snapshot.settings.reminderAutoCloseSeconds || 30;
  startCountdown(closeSeconds);
  closeTimer = window.setTimeout(() => window.close(), closeSeconds * 1000);

  const isBreak = snapshot.state.mode === "shortBreak" || snapshot.state.mode === "longBreak";
  startBreakButton.hidden = !isBreak;
}

async function act(type, extra = {}) {
  statusEl.textContent = "正在处理...";
  await sendMessage({ type, ...extra });
  clearTimers();
  window.close();
}

startBreakButton.addEventListener("click", () => act(MESSAGE_TYPES.startBreak));
snooze5Button.addEventListener("click", () => act(MESSAGE_TYPES.snooze, { minutes: 5 }));
snooze10Button.addEventListener("click", () => act(MESSAGE_TYPES.snooze, { minutes: 10 }));
skipButton.addEventListener("click", () => act(MESSAGE_TYPES.skip));

window.addEventListener("beforeunload", clearTimers);

await loadState();
