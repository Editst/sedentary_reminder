import { MESSAGE_TYPES, MODES } from "../shared/constants.js";

const modeEl = document.querySelector("#mode");
const detailEl = document.querySelector("#detail");
const remainingEl = document.querySelector("#remaining");
const remainingLabelEl = document.querySelector("#remaining-label");
const cycleEl = document.querySelector("#cycle");
const windowStateEl = document.querySelector("#window-state");
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
        reject(new Error(response?.error || "未知错误"));
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
  modeEl.textContent = snapshot.enabled ? snapshot.modeLabel : "提醒已关闭";
  detailEl.textContent = snapshot.enabled
    ? snapshot.currentPhaseLabel
    : "如需继续使用，请在设置页重新启用提醒。";
  remainingEl.textContent = formatDuration(snapshot.remainingMs);
  remainingLabelEl.textContent = snapshot.state.mode === MODES.paused ? "冻结的剩余时间" : "距离下一次动作";
  cycleEl.textContent = `长休息进度：第 ${snapshot.state.cycleCount} 轮`;
  windowStateEl.textContent = snapshot.reminderVisible
    ? `提醒窗口已打开${snapshot.reminderKind === "test" ? "（测试提醒）" : ""}`
    : "提醒窗口当前未打开";
  pauseButton.disabled = !snapshot.canPause || !snapshot.enabled;
  resumeButton.disabled = !snapshot.canResume || !snapshot.enabled;
  testButton.disabled = !snapshot.enabled;
  statusEl.textContent = snapshot.enabled
    ? (snapshot.reminderVisible ? "如重复点击测试提醒，将直接聚焦现有提醒窗口。" : "后台运行正常。")
    : "提醒关闭时不会再调度通知或提醒页。";
}

async function refresh() {
  const snapshot = await sendMessage({ type: MESSAGE_TYPES.getStatus });
  render(snapshot);
}

pauseButton.addEventListener("click", async () => {
  statusEl.textContent = "正在暂停提醒...";
  await sendMessage({ type: MESSAGE_TYPES.pause });
  await refresh();
});

resumeButton.addEventListener("click", async () => {
  statusEl.textContent = "正在恢复提醒...";
  await sendMessage({ type: MESSAGE_TYPES.resume });
  await refresh();
});

testButton.addEventListener("click", async () => {
  statusEl.textContent = "正在打开测试提醒...";
  await sendMessage({ type: MESSAGE_TYPES.testReminder });
  await refresh();
});

optionsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

await refresh();
