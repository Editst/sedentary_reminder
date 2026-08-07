import { MESSAGE_TYPES } from "../shared/constants.js";

const titleEl = document.querySelector("#title");
const messageEl = document.querySelector("#message");
const countdownEl = document.querySelector("#countdown");
const countdownCopyEl = document.querySelector("#countdown-copy");
const progressEl = document.querySelector("#progress");
const statusEl = document.querySelector("#status");
const primaryActionButton = document.querySelector("#primary-action");
const snoozeActionsEl = document.querySelector("#snooze-actions");
const skipButton = document.querySelector("#skip");

let countdownTimer = null;
let syncTimer = null;
let closeTimer = null;
let remainingSeconds = 0;
let initialSeconds = 0;
let primaryAction = MESSAGE_TYPES.skip;
let countdownStarted = false;

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

function formatSeconds(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderCountdown() {
  const safeSeconds = Math.max(0, remainingSeconds);
  const ratio = initialSeconds > 0 ? safeSeconds / initialSeconds : 0;
  countdownEl.textContent = formatSeconds(safeSeconds);
  countdownCopyEl.textContent = `当前提醒页将在 ${safeSeconds} 秒后自动关闭。`;
  progressEl.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;

  if (remainingSeconds <= 0) {
    statusEl.textContent = "倒计时结束，提醒页即将关闭。";
    clearTimers();
    window.close();
    return;
  }

  remainingSeconds -= 1;
}

function startCountdown(seconds) {
  initialSeconds = Math.max(1, seconds);
  remainingSeconds = Math.max(0, seconds);
  countdownStarted = true;
  renderCountdown();

  if (countdownTimer) {
    window.clearInterval(countdownTimer);
  }

  countdownTimer = window.setInterval(renderCountdown, 1000);

  if (closeTimer) {
    window.clearTimeout(closeTimer);
  }
  closeTimer = window.setTimeout(() => window.close(), seconds * 1000);
}

function clearTimers() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  if (syncTimer) {
    window.clearInterval(syncTimer);
    syncTimer = null;
  }

  if (closeTimer) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function renderSnoozeButtons(snoozeOptions, visible) {
  snoozeActionsEl.textContent = "";

  if (!visible || !Array.isArray(snoozeOptions) || snoozeOptions.length === 0) {
    return;
  }

  for (const minutes of snoozeOptions) {
    const button = document.createElement("button");
    button.textContent = `延后 ${minutes} 分钟`;
    button.addEventListener("click", () => void act(MESSAGE_TYPES.snooze, { minutes }));
    snoozeActionsEl.appendChild(button);
  }
}

function renderReadonlyState() {
  primaryAction = MESSAGE_TYPES.skip;
  primaryActionButton.textContent = "关闭提醒页";
  renderSnoozeButtons([], false);
  skipButton.hidden = true;
}

function renderActions(snapshot) {
  if (!snapshot.hasActiveReminder) {
    renderReadonlyState();
    statusEl.textContent = "当前没有有效提醒动作。此页面仅用于查看并可直接关闭。";
    return;
  }

  if (snapshot.reminderKind === "test") {
    primaryAction = MESSAGE_TYPES.skip;
    primaryActionButton.textContent = "关闭测试提醒";
    renderSnoozeButtons([], false);
    skipButton.hidden = true;
    return;
  }

  if (snapshot.canEndBreak) {
    primaryAction = MESSAGE_TYPES.endBreak;
    primaryActionButton.textContent = "结束休息，返回工作";
    renderSnoozeButtons([], false);
    skipButton.hidden = true;
    return;
  }

  if (snapshot.canStartBreak) {
    primaryAction = MESSAGE_TYPES.startBreak;
    primaryActionButton.textContent = "立即开始休息";
    const options = snapshot.settings?.snoozeMinutesOptions ?? [5, 10];
    renderSnoozeButtons(options, snapshot.canSnooze);
    skipButton.hidden = false;
    skipButton.textContent = "暂不处理";
    return;
  }

  renderReadonlyState();
  statusEl.textContent = "当前状态不允许执行提醒动作。你可以直接关闭此窗口。";
}

function renderSnapshot(snapshot) {
  titleEl.textContent = snapshot.reminderTitle;
  messageEl.textContent = snapshot.reminderMessage;
  statusEl.textContent = snapshot.reminderVisible
    ? "提醒窗口已进入单实例模式，重复触发会直接聚焦当前窗口。"
    : "提醒窗口已同步最新状态。";
  renderActions(snapshot);

  if (!countdownStarted) {
    const closeSeconds = snapshot.autoCloseSeconds || snapshot.settings.reminderAutoCloseSeconds || 30;
    startCountdown(closeSeconds);
  }
}

async function syncSnapshot() {
  try {
    const snapshot = await sendMessage({ type: MESSAGE_TYPES.getStatus });
    renderSnapshot(snapshot);
  } catch (error) {
    statusEl.textContent = `同步状态失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function act(type, extra = {}) {
  statusEl.textContent = "正在处理你的操作...";
  try {
    await sendMessage({ type, ...extra });
    clearTimers();
    window.close();
  } catch (error) {
    statusEl.textContent = `操作失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

primaryActionButton.addEventListener("click", () => void act(primaryAction));
skipButton.addEventListener("click", () => void act(MESSAGE_TYPES.skip));
window.addEventListener("beforeunload", clearTimers);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void syncSnapshot();
  }
});

void syncSnapshot();
syncTimer = window.setInterval(() => {
  void syncSnapshot();
}, 5000);
