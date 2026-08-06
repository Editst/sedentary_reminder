# Changelog

All notable changes to this project will be documented in this file.

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
