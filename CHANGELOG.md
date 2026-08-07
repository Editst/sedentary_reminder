# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-08-07

### Fix
- **service-worker**: 修正 `canEndBreak` / `canStartBreak` / `canSnooze` 判定条件，不再依赖 `notificationOpen`。修复用户无法从 popup 手动结束休息、关闭提醒页后无法开始休息的 CRITICAL 级缺陷。
- **service-worker**: 删除模块顶层 `void bootstrapRuntime()`，仅保留 `onInstalled` / `onStartup` 事件入口。消除 Worker 唤醒时与 `onAlarm` 事件的双重 reconcile 导致的重复系统通知。
- **service-worker**: `handlePause` 与 `handleResume` 中清零 `snoozedUntil`，修复贪睡后暂停再恢复时闹钟在旧贪睡时间点提前触发的问题。
- **service-worker**: `handleSaveSettings` 调用 `clearResumeLock` 清除 `preserveSessionEnd`，修复恢复后修改设置不生效的问题。
- **service-worker**: `scheduleMainAlarm` 增加 `Number.isFinite` 校验，防止传入 `NaN` 时 `chrome.alarms.create` 抛 TypeError。
- **service-worker**: 所有事件监听器增加 `.catch()` 异常兜底；`onMessage` 的 `catch` 块中 `sendResponse` 外层增加 try/catch 防止端口断开时的二次异常。
- **notification**: 倒计时归零时调用 `clearTimers()` 再 `window.close()`，修复遗留 interval 泄漏。

### Feat
- **notification**: 贪睡按钮改为根据用户设置的 `snoozeMinutesOptions` 动态渲染，不再硬编码 5/10 分钟。
- **popup**: 增加 `setInterval(refresh, 1000)` 每秒刷新，剩余时间实时倒计。
- **notification**: 进度条增加 `transition: transform 1s linear` CSS 过渡，倒计时平滑动画。

### Refactor
- **service-worker**: 删除无引用的 `bootstrapRuntime` 函数。
- **manifest**: `options_page` 迁移至 MV3 推荐的 `options_ui` 声明。
- **notification**: HTML 中硬编码贪睡按钮替换为 `#snooze-actions` 动态容器，CSS 增加 `.snooze-group` display:contents 布局。

### Test
- **tdd**: 新增 5 项测试用例覆盖 `canEndBreak`/`canStartBreak` 条件判定、`snoozedUntil` 清零、`preserveSessionEnd` 清除、`scheduleMainAlarm` NaN 防护。全量测试用例增至 22 项且全部通过。

## [1.1.0] - 2026-08-06

### Fix
- **service-worker**: 拆分 `_reconcileRuntimeInner` 解除 `handleSaveSettings` 与 `handleResume` 在 `withStateLock` 中的自嵌套死锁。
- **service-worker**: 修正 `handleSkip` 调度逻辑，跳过提醒后重置并开启完整工作周期（`workMinutes`），修复误用 `breakCountdownSeconds` 导致频繁弹窗的问题。
- **service-worker**: 将 `tabs.onRemoved` 状态重置纳入 `withStateLock`，消除多标签并发关闭时的竞态写入。
- **service-worker**: 为 `createSystemNotification` 增加 try/catch 异常防护，防止系统通知权限关闭时抛出未捕获异常中断主状态流。
- **storage**: 在 `normalizeState` 中引入严格白名单属性过滤，防御持久化未知脏属性并校验 `reminderKind` 与 `preserveSessionEnd`。
- **ui**: 移除 `popup.js`、`notification.js`、`options.js` 顶层裸 `await`，为异步操作增设完整的 try/catch 异常捕获与错误提示。
- **theme**: 将 `popup.css` 的 `color-scheme` 修正为 `dark`，匹配实际暗色背景主题。

### Refactor
- **manifest**: 将 `manifest.json` 迁移至 `src/` 目录，统一扩展加载源路径为 `src/`。
- **docs**: 整合原有分散设计文档至 `README.md`，规范化工程架构文档。

### Test
- **tdd**: 新增 `tests/service-worker.test.js`（并发死锁复现与跳过调度验证）与 `tests/storage.test.js`（状态清洗验证），全量测试用例增至 16 项且全部通过。
