import { MESSAGE_TYPES, MODES } from "../shared/constants.js";
import { sendExtensionMessage } from "../shared/messaging.js";
import { formatDurationMs } from "../shared/timer_engine.js";

const modeEl = document.querySelector("#mode");
const detailEl = document.querySelector("#detail");
const remainingEl = document.querySelector("#remaining");
const remainingLabelEl = document.querySelector("#remaining-label");
const cycleEl = document.querySelector("#cycle");
const windowStateEl = document.querySelector("#window-state");
const statusEl = document.querySelector("#status");
const contextActionButton = document.querySelector("#context-action");
const pauseButton = document.querySelector("#pause");
const resumeButton = document.querySelector("#resume");
const testButton = document.querySelector("#test");
const optionsButton = document.querySelector("#open-options");

let currentContextAction = null;
let isRefreshing = false;

function render(snapshot) {
  if (!snapshot.enabled) {
    modeEl.textContent = "提醒已关闭";
    detailEl.textContent = "如需继续使用，请在设置页重新启用提醒。";
    remainingLabelEl.textContent = "计时已停止";
  } else if (snapshot.inSchedule === false) {
    modeEl.textContent = "非生效时段";
    detailEl.textContent = "当前处于工作时段外，定时器已静默休眠。";
    remainingLabelEl.textContent = "距离下次生效";
  } else {
    modeEl.textContent = snapshot.modeLabel;
    detailEl.textContent = snapshot.currentPhaseLabel;
    remainingLabelEl.textContent =
      snapshot.state.mode === MODES.paused ? "冻结的剩余时间" : "距离下一次动作";
  }

  remainingEl.textContent = formatDurationMs(snapshot.remainingMs);
  cycleEl.textContent = `长休息进度：第 ${snapshot.state.cycleCount} 轮`;
  windowStateEl.textContent = snapshot.reminderVisible
    ? `提醒窗口已打开${snapshot.reminderKind === "test" ? "（测试提醒）" : ""}`
    : "提醒窗口当前未打开";

  if (snapshot.canEndBreak && snapshot.enabled) {
    contextActionButton.textContent = "结束休息，返回工作";
    contextActionButton.classList.remove("hidden");
    contextActionButton.disabled = false;
    currentContextAction = MESSAGE_TYPES.endBreak;
  } else if (snapshot.canStartBreak && snapshot.enabled) {
    contextActionButton.textContent = "立即开始休息";
    contextActionButton.classList.remove("hidden");
    contextActionButton.disabled = false;
    currentContextAction = MESSAGE_TYPES.startBreak;
  } else {
    contextActionButton.classList.add("hidden");
    currentContextAction = null;
  }

  pauseButton.disabled = !snapshot.canPause || !snapshot.enabled;
  resumeButton.disabled = !snapshot.canResume || !snapshot.enabled;
  testButton.disabled = !snapshot.enabled;

  if (!snapshot.enabled) {
    statusEl.textContent = "提醒关闭时不会再调度通知或提醒页。";
  } else if (snapshot.inSchedule === false) {
    statusEl.textContent = "处于非生效时段，免打扰休眠中。";
  } else if (snapshot.reminderVisible) {
    statusEl.textContent = "如重复点击测试提醒，将直接聚焦现有提醒窗口。";
  } else {
    statusEl.textContent = "后台运行正常。";
  }
}

async function refresh() {
  if (isRefreshing) {
    return;
  }
  isRefreshing = true;
  try {
    const snapshot = await sendExtensionMessage({ type: MESSAGE_TYPES.getStatus });
    render(snapshot);
  } catch (error) {
    statusEl.textContent = `读取状态失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    isRefreshing = false;
  }
}

async function handleAction(type, loadingText, errorPrefix) {
  statusEl.textContent = loadingText;
  try {
    await sendExtensionMessage({ type });
    await refresh();
  } catch (error) {
    statusEl.textContent = `${errorPrefix}：${error instanceof Error ? error.message : String(error)}`;
  }
}

contextActionButton.addEventListener("click", () => {
  if (currentContextAction) {
    void handleAction(currentContextAction, "正在处理操作...", "操作失败");
  }
});

pauseButton.addEventListener("click", () => {
  void handleAction(MESSAGE_TYPES.pause, "正在暂停提醒...", "暂停失败");
});

resumeButton.addEventListener("click", () => {
  void handleAction(MESSAGE_TYPES.resume, "正在恢复提醒...", "恢复失败");
});

testButton.addEventListener("click", () => {
  void handleAction(MESSAGE_TYPES.testReminder, "正在打开测试提醒...", "测试提醒失败");
});

optionsButton.addEventListener("click", async () => {
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    statusEl.textContent = `打开设置页失败：${error instanceof Error ? error.message : String(error)}`;
  }
});

if (globalThis.chrome?.storage?.onChanged) {
  globalThis.chrome.storage.onChanged.addListener(() => {
    void refresh();
  });
}

void refresh();
window.setInterval(() => {
  void refresh();
}, 1000);
