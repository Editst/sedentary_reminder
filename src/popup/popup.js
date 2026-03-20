import { MESSAGE_TYPES } from "../shared/constants.js";

const modeEl = document.querySelector("#mode");
const detailEl = document.querySelector("#detail");
const remainingEl = document.querySelector("#remaining");
const statusEl = document.querySelector("#status");
const pauseButton = document.querySelector("#pause");
const resumeButton = document.querySelector("#resume");
const testButton = document.querySelector("#test");
const optionsButton = document.querySelector("#open-options");

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

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function render(snapshot) {
  modeEl.textContent = snapshot.modeLabel;
  detailEl.textContent = snapshot.currentPhaseLabel;
  remainingEl.textContent = formatDuration(snapshot.remainingMs);
  pauseButton.disabled = !snapshot.canPause;
  resumeButton.disabled = !snapshot.canResume;
  statusEl.textContent = snapshot.reminderVisible
    ? "提醒页已打开"
    : `循环：${snapshot.state.cycleCount}，${snapshot.state.mode}`;
}

async function refresh() {
  const snapshot = await sendMessage({ type: MESSAGE_TYPES.getStatus });
  render(snapshot);
}

pauseButton.addEventListener("click", async () => {
  statusEl.textContent = "正在暂停...";
  await sendMessage({ type: MESSAGE_TYPES.pause });
  await refresh();
});

resumeButton.addEventListener("click", async () => {
  statusEl.textContent = "正在恢复...";
  await sendMessage({ type: MESSAGE_TYPES.resume });
  await refresh();
});

testButton.addEventListener("click", async () => {
  statusEl.textContent = "正在发送测试提醒...";
  await sendMessage({ type: MESSAGE_TYPES.testReminder });
  await refresh();
});

optionsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

await refresh();
