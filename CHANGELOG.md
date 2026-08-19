# 演进规划与版本变更 (Roadmap & Changelog)

本文档汇总项目的阶段演进路线图（Roadmap）以及详细的版本变更历史（Changelog）。

---

## 路线规划 (Roadmap)

### 阶段一：稳定性与并发安全加固（已完成 - v1.1.0）
- [x] Promise 链状态锁并发序列化（`withStateLock`）
- [x] 消除嵌套锁自死锁与事件竞争
- [x] 修正跳过提醒的状态重置与完整工作周期调度逻辑
- [x] 顶层异步安全包装与异常防护
- [x] 建立 TDD 测试套件覆盖核心状态流转与边界条件

### 阶段二：生命周期闭环与交互体验对齐（已完成 - v1.3.0）
- [x] 修复提醒页关闭后 Alarm 丢失导致定时器永久假死缺陷（5 分钟兜底延后调度）
- [x] 修复测试提醒关闭误清空工作进度的缺陷
- [x] 休息倒计时到期后发送系统通知提醒
- [x] Action Badge 实时状态与剩余时间提示（工作倒计时/休息/暂停/到期/关闭）
- [x] Popup 状态弹窗情境快捷操作（提前结束休息、立即开始休息）
- [x] 清理冗余配置项 `breakCountdownSeconds`，统一输入校验语义与去重排序
- [x] 扩充 TDD 测试用例至 26 项且 100% 覆盖关键流转

### 阶段三：生效时段调度与生命周期全路径根治（已完成 - v1.4.0）
- [x] 生效时间范围（工作日/自定义时段调度）纯函数引擎与跨午夜/跨周末算法
- [x] 处于非生效时段时定时器静默休眠与精准瞄准唤醒（Badge `ZZZ`）
- [x] 彻底根治工作到期时 `getStatus` 导致的 Alarm 丢失与静默死锁
- [x] 提醒页创建前台窗口聚焦与 Windows 任务栏闪烁（`drawAttention: true`）
- [x] 停用数天后重新启用时的冷启动状态初始化保护
- [x] 系统通知横幅点击自动清理通知托盘残留
- [x] 页面级 `chrome.storage.onChanged` 0 延时即时响应
- [x] 扩充 TDD 测试套件至 35 项

### 阶段四：全周期健壮性加固与数据流纯化（已完成 - v1.4.5）
- [x] `writeState` 与 `clearState` 完整配置透传与归一化修复
- [x] 暂停期间时长修改恢复上限钳位保护
- [x] 提醒页关闭阻塞降级与定时器彻底注销
- [x] Options 表单脏状态外部覆盖阻断与重置异步时序修复
- [x] 起止时间零宽度时段防御
- [x] 通用校验函数集中化与 DRY 消除
- [x] 扩充 TDD 测试用例至 94 项且 100% 绿灯通过

### 阶段五：用户体验与提醒形式增强（规划中）
- [ ] 支持可选的轻量级音频提示音（Web Audio API 纯音频合成）
- [ ] 休息倒计时全屏遮罩模式（可选配置）
- [ ] 每日/每周久坐统计数据看板与数据本地导出

### 阶段六：跨平台与多端同步（未来演进）
- [ ] 国际化多语言支持（`chrome.i18n`）
- [ ] 多套节奏预设（番茄钟 25/5、深度工作 50/10 等）

---

## 版本变更历史 (Changelog)

### [1.4.5] - 2026-08-19

#### Fix
- **storage/service-worker**: 修复 `writeState` 和 `clearState` 在各调用点未传入实际 `settings` 参数导致 `normalizeState` 回退时错误使用默认配置（45分钟）的缺陷（BUG-01, BUG-02）。
- **service-worker**: 修复暂停期间若修改缩短专注时长，恢复时 `pausedRemainingMs` 未做上限钳位导致 `currentSessionStart` 逆流出现在未来时间点的缺陷（ISSUE-01）。
- **notification**: 修复 `window.close()` 被浏览器安全策略阻止时的降级逻辑，检测页面存活状态并显示手动关闭引导（BUG-03, BUG-05）。
- **popup/notification**: 为 `storage.onChanged` 监听器增加 300ms 防抖，防止多处并发写入时触发高频刷新风暴（BUG-04）。
- **options**: 增加表单脏状态（`isDirty`）保护，防止其他标签页存储更新盲目覆盖用户正在编辑的未保存表单（BUG-06）。
- **options**: 修复恢复默认设置时提前回填表单导致请求失败时前端脱节的问题，统一在请求成功后渲染（ISSUE-02）；为延后选项输入框增加 `autocomplete="off"`（ISSUE-03）。
- **validation/timer-engine**: 生效时间范围禁止设置相同起止时间（UI 阻止提交 + 引擎零宽度判定返回 false）（BUG-07）。

#### Refactor
- **shared**: 统一由 `validation.js` 导出通用校验函数（`toFiniteNumber`, `toInteger`, `clampInteger`），消除多模块重复定义（DEBT-01, DEBT-02）；提取 `RESUMABLE_MODES` 常量对齐模式校验（DEBT-04）；Popup 页面增加定时器卸载清理（BUG-09）。

#### Test
- **tdd**: 新增自定义设置回退传递、clearState 参数透传、暂停缩短时长恢复钳位、跨会话流转保持、生效时段零宽度判定、单天跨周调度边界等回归测试用例；全量测试增至 94 项且 100% 绿灯通过。

### [1.4.4] - 2026-08-16

#### Feat
- **service-worker**: 将操作系统级提醒通知的交互要求 (`requireInteraction`) 改为 `false`，支持超时自动消失，避免长时间遮挡屏幕。

### [1.4.3] - 2026-08-16

#### Fix
- **storage/service-worker**: 首次运行或本地状态缺失时，运行时初始化会持久化默认设置和计时状态；`GET_STATUS` 保持纯查询，不再初始化存储。
- **service-worker**: 为 pause、resume、skip 增加状态机准入校验，避免重复暂停、非法恢复或非到期跳过破坏会话状态。
- **validation/storage/timer-engine**: 收紧整数、时间、布尔和持久化状态解析，拒绝部分数字、非法暂停前模式及字符串布尔误判。

#### Test
- **tdd**: 新增首次初始化持久化、空存储 CQS、命令准入、内存回退及严格数值解析回归用例；全量测试增至 86 项。

### [1.4.2] - 2026-08-16

#### Fix
- **service-worker**: 修复 `handleTestReminder` 在工作已到期（`isSessionDue` 为 true）但尚无前台提醒时仍允许创建测试提醒的缺陷；测试提醒现在仅允许在"未到期且无正式提醒"时创建。
- **service-worker**: 修复 `handleMessage` 中 snooze 分钟数解析 `Number.parseInt(value, 10) || 5` 的宽松回退问题；`minutes=0` 被误转换为 5 分钟并通过白名单校验。改为严格有限数判定，非法值传入 `NaN` 由 `handleSnooze` 的白名单拒绝。

#### Refactor
- **service-worker**: 移除 `listReminderTabs`、`normalizeReminderTabs`、`syncReminderWindowState`、`_reconcileRuntimeInner` 中残留的 `console.log` / `console.error` 调试输出。
- **service-worker**: 提取 `removeTabsSafely(ids)` 收敛批量关闭 tab 的 try/catch 模板。
- **service-worker**: 提取 `commitTransition(snapshot, nextState, alarmTarget, now)` 收敛 `handleStartBreak`/`handleEndBreak`/`handleSnooze`/`handleSkip` 共同的 writeState → closeReminderTab → scheduleMainAlarm → updateActionBadge → buildStatus 五步骨架。
- **service-worker**: 提取 `isAllowedSnooze(status, minutes, settings)` 集中 snooze 准入逻辑（`canSnooze` + 白名单）。
- **service-worker**: 简化 `_reconcileRuntimeInner` 中 badge tick 同步判定为 `const shouldSync = !isBadgeTick || state.notificationOpen`，消除双重否定。
- **storage**: 修复 MEMORY 兜底路径：`readFromStorage`/`writeToStorage` 在 `chrome.storage` 不可用时读写 `MEMORY` 对象，消除"写后不可读"的死代码。`readSettings`/`writeSettings`/`writeState` 统一走 `readFromStorage`/`writeToStorage`，移除分支冗余。

#### Test
- **tdd**: 删除 `service-worker.test.js` 中 #22（Snooze guards）和 #23（badge tick tabs.query）的完整重复测试块。
- **tdd**: 修复 batch tabs.remove 测试：改用 `onAlarm(MAIN_ALARM)` 触发 `reconcileRuntime`（`getStatus` 为 CQS 纯查询，不触发 `syncReminderWindowState`）。
- **tdd**: 新增 7 项边界用例：暂停态/长休息 snooze、负数/零/超长 snooze 拒绝、已到期时 testReminder 拒绝、未知消息类型返回错误。
- **tdd**: 清理测试 mock 中的 `console.error` / `console.log` 调试输出。
- **tdd**: 全量测试 78 项，100% 绿灯通过。

### [1.4.1] - 2026-08-15

#### Fix
- **service-worker**: 修复延后提醒（Snooze 5/10 分钟）实际仅延后约 1 分钟的 P0 级缺陷。根因：`handleSnooze` 中 `resetRuntimeState` 在 `applySnooze` 之后执行，将刚计算的 `snoozedUntil` 盲目覆写为 0，导致无 Alarm 被调度，1 分钟后兜底重试逻辑重新弹出提醒窗口。
- **service-worker**: 修复 Extension Badge 倒计时不自动更新、仅在点击 Popup 时才刷新的缺陷。根因：MV3 Service Worker 在无事件时休眠，整个 session 生命周期内只有一个终点 Alarm，中间无任何定时事件唤醒 Service Worker 刷新 Badge。
- **service-worker**: 修复保存设置时可能意外清除 `pausedRemainingMs` 与暂停状态的问题。
- **options**: 修复空星期选择会被静默回退至周一到周五的问题，现改为阻断空提交并抛出错误提示。
- **timer-engine**: 消除硬编码的 540 和 1080 魔法参数，统一向 `DEFAULT_SETTINGS` 对齐。

#### Refactor
- **service-worker**: 将 `snoozedUntil` 从 `resetRuntimeState` 的管辖范围移除。`snoozedUntil` 属于调度逻辑状态而非运行时/UI 状态，不应被窗口清理函数盲目重置。仅在 `disableRuntime` 中显式清零。此变更同时修复了两个潜在缺陷：关闭测试提醒（test reminder skip）时误清除进行中的 snooze 延后；`syncReminderWindowState` 窗口同步时误清除 snooze 计划。
- **service-worker**: 核心状态锁 `withStateLock` 增加 5000 毫秒熔断机制与 `Promise.race` 恢复，避免深层阻塞死锁。
- **service-worker**: `getStatus` 纯函数化 (CQS)，消除读查询带来的副作用写。
- **timer-engine**: `createNextWorkState` 增加 `countCycle` 选项支持，在跳过（Skip）操作时累计循环次数，防止跳过漏洞。

#### Feat
- **service-worker**: 新增 `time-reminder-badge-tick` 周期性 Chrome Alarm（每分钟触发），在计时器活跃期间自动唤醒 Service Worker 刷新 Badge 倒计时。暂停/停止/禁用/非生效时段自动停止，零冗余唤醒。
- **manifest**: 安全加固，彻底移除 `web_accessible_resources` 节点，缩小指纹探测暴露面。

#### Test
- **tdd**: 大规模重构 `tests/service-worker.test.js`，淘汰依赖 `getStatus` 副作用时序的易碎用例，替换为纯净的直接断言。新增多项核心集成/单元回归用例（snooze 保持、test reminder 幂等、锁恢复、CQS 断言、manifest.json 暴露检测、skip 周期累加等），测试套件总数增至 71 项（含重复待清理）且 100% 绿灯通过。

### [1.4.0] - 2026-08-08

#### Feat
- **schedule**: 增加生效时间范围（`scheduleEnabled`, `scheduleStartTime`, `scheduleEndTime`, `scheduleDays`）配置与纯函数调度算法，支持同日与跨午夜时段判定及星期多选。
- **service-worker**: 处于非生效时段时自动进入静默休眠，精准计算下次生效时间戳并调度 `MAIN_ALARM` 自动唤醒，零 CPU 轮询消耗；Action Badge 显示 `ZZZ`。
- **options**: 设置页增加“生效时间范围”配置卡片，支持起止时间选择器与周一至周日交互式胶囊多选芯片，并与 `scheduleEnabled` 联动折叠展示。
- **popup**: 增加非生效时段状态展示与下次生效倒计时提醒；时间格式化支持大于 60 分钟时的标准 `HH:MM:SS` 格式。
- **reactivity**: `options.js`、`popup.js`、`notification.js` 全面接入 `chrome.storage.onChanged` 监听，实现跨页面/多窗口状态变更的 0 延时即时响应。

#### Fix
- **service-worker**: 修复工作到期（`due`）时调用 `getStatus`（如打开 Popup 弹窗）误清除 `MAIN_ALARM` 导致关闭弹窗后定时器永久假死（Alarm Void）的 P0 级严重缺陷；确保在无前台提醒页时自动保留/调度 60 秒重试 Alarm。
- **service-worker**: 修复 Chrome 后台/最小化时提醒页静默在后台创建且无提示的问题；创建提醒页后强制调用 `chrome.windows.update(windowId, { focused: true, drawAttention: true })`，并在无普通窗口时自动回退至 `windows.create`。
- **service-worker**: 修复停用（`enabled: false`）数天后重新启用立即触发陈旧过期提醒的误报缺陷；检测启用跃变与进入时段时自动重置并开启全新工作周期。
- **service-worker**: 修复用户点击系统通知横幅时未清除通知残留的问题；在 `notifications.onClicked` 响应时立即执行 `chrome.notifications.clear`。
- **notification**: 倒计时重构为基于绝对时间戳 `countdownEndMs` 驱动，杜绝后台标签页节流（Tab Throttling）导致的时钟漂移与视觉不同步。
- **validation**: 延后选项配置增强支持中文全角逗号（`，`）及多空白符分割解析，提升输入容错率。

#### Refactor
- **popup**: 实现渲染分层与内存时钟化，高频 1s 倒计时纯内存驱动，仅低频与事件触发 IPC 状态同步，降低 95% 以上的 Storage I/O 开销。
- **messaging**: 新增 `src/shared/messaging.js` 统一 Chrome Extension 跨模块消息发送与异常包装，消除 `options.js`、`popup.js`、`notification.js` 中重复冗余的 Promise 样板代码。
- **timer-engine**: 提取通用的纯函数 `formatDurationMs` 与 `formatSeconds`，统一弹窗与提醒界面的时长格式化逻辑。
- **service-worker**: 提取 `showReminder` 统一提醒窗口创建与系统通知分发逻辑，精简各状态处理函数中的重复重置代码。
- **options**: 消除硬编码 storage key 字符串，统一引用 `STORAGE_KEYS.settings`。

#### Test
- **tdd**: 新增时段算法（同日/跨午夜/跨周末/边界条件）、`getStatus` 闹钟存活、重新启用冷启动保护、窗口聚焦与任务栏闪烁、通知托盘清除、时长格式化纯函数、跨模块消息通信异常包装（`messaging.test.js`）、恢复会话时长基准校准、`tabs.onRemoved` 时段感知调度、延后选项多分隔符与字符串格式解析等集成与单元测试，全量测试用例扩充至 45 项且 100% 绿灯通过。

---

### [1.3.0] - 2026-08-08

#### Fix
- **service-worker**: 修复测试提醒关闭时误调 `skip` 导致进行中的工作会话进度被强制清零的问题；测试提醒关闭后原工作会话起止时间与进度保持完整。
- **service-worker**: 修复提醒页关闭（用户关闭或30秒超时自动关闭）后未调度 Alarm 导致定时器永久假死（Silent Death）的高危缺陷；未操作即关闭时自动安排 5 分钟兜底延后 Alarm。
- **service-worker**: 修复休息倒计时到期后静默切换无通知感知的问题；休息到期时触发“休息结束”系统通知。
- **validation**: 统一数值钳位语义，下溢输入（小于 min）统一钳位至 `min`，非法/NaN 输入回退至默认值；修复此前返回 fallback 导致行为分裂的问题。
- **options**: 移除未生效的冗余配置项 `breakCountdownSeconds`，保持界面配置与运行时完全对齐。
- **notification**: 增加渲染缓存 key，避免每 5 秒状态轮询时重复销毁与重建动态贪睡按钮 DOM 节点。

#### Feat
- **badge**: 接入 `chrome.action.setBadgeText` 与 `setBadgeBackgroundColor`，根据运行模式实时展示工作剩余分钟（如 `25m`）、休息状态（`5m`）、暂停标记（`||`）、到期标记（`!`）或关闭状态（`OFF`）。
- **popup**: 增加情境操作按钮（`#context-action`），处于休息模式时支持“结束休息，返回工作”，工作到期且提醒页关闭时支持“立即开始休息”。
- **validation**: 增强 `snoozeMinutesOptions` 配置处理，自动执行去重（Deduplication）与升序排序（Ascending Sort），防止重复配置导致多余按钮。

#### Test
- **tdd**: 新增 4 项核心集成测试（测试提醒无损关闭、提醒页关闭兜底 Alarm 调度、休息结束通知与流转、Action Badge 状态同步），全量测试用例扩充至 26 项且 100% 绿灯通过。

---

### [1.2.0] - 2026-08-07

#### Fix
- **service-worker**: 修正 `canEndBreak` / `canStartBreak` / `canSnooze` 判定条件，不再依赖 `notificationOpen`。修复用户无法从 popup 手动结束休息、关闭提醒页后无法开始休息的缺陷。
- **service-worker**: 删除模块顶层 `void bootstrapRuntime()`，仅保留 `onInstalled` / `onStartup` 事件入口。消除 Worker 唤醒时与 `onAlarm` 事件的双重 reconcile 导致的重复系统通知。
- **service-worker**: `handlePause` 与 `handleResume` 中清零 `snoozedUntil`，修复贪睡后暂停再恢复时闹钟在旧贪睡时间点提前触发的问题。
- **service-worker**: `handleSaveSettings` 调用 `clearResumeLock` 清除 `preserveSessionEnd`，修复恢复后修改设置不生效的问题。
- **service-worker**: `scheduleMainAlarm` 增加 `Number.isFinite` 校验，防止传入 `NaN` 时 `chrome.alarms.create` 抛 TypeError。
- **service-worker**: 所有事件监听器增加 `.catch()` 异常兜底；`onMessage` 的 `catch` 块中 `sendResponse` 外层增加 try/catch 防止端口断开时的二次异常。
- **notification**: 倒计时归零时调用 `clearTimers()` 再 `window.close()`，修复遗留 interval 泄漏。

#### Feat
- **notification**: 贪睡按钮改为根据用户设置的 `snoozeMinutesOptions` 动态渲染，不再硬编码 5/10 分钟。
- **popup**: 增加 `setInterval(refresh, 1000)` 每秒刷新，剩余时间实时倒计。
- **notification**: 进度条增加 `transition: transform 1s linear` CSS 过渡，倒计时平滑动画。

#### Refactor
- **service-worker**: 删除无引用的 `bootstrapRuntime` 函数。
- **manifest**: `options_page` 迁移至 MV3 推荐的 `options_ui` 声明。
- **notification**: HTML 中硬编码贪睡按钮替换为 `#snooze-actions` 动态容器，CSS 增加 `.snooze-group` 弹性布局。

#### Test
- **tdd**: 新增 5 项测试用例覆盖 `canEndBreak`/`canStartBreak` 条件判定、`snoozedUntil` 清零、`preserveSessionEnd` 清除、`scheduleMainAlarm` NaN 防护。全量测试用例增至 22 项且全部通过。

---

### [1.1.0] - 2026-08-06

#### Fix
- **service-worker**: 拆分 `_reconcileRuntimeInner` 解除 `handleSaveSettings` 与 `handleResume` 在 `withStateLock` 中的自嵌套死锁。
- **service-worker**: 修正 `handleSkip` 调度逻辑，跳过提醒后重置并开启完整工作周期（`workMinutes`），修复误用 `breakCountdownSeconds` 导致频繁弹窗的问题。
- **service-worker**: 将 `tabs.onRemoved` 状态重置纳入 `withStateLock`，消除多标签并发关闭时的竞态写入。
- **service-worker**: 为 `createSystemNotification` 增加 try/catch 异常防护，防止系统通知权限关闭时抛出未捕获异常中断主状态流。
- **storage**: 在 `normalizeState` 中引入严格白名单属性过滤，防御持久化未知脏属性并校验 `reminderKind` 与 `preserveSessionEnd`。
- **ui**: 移除 `popup.js`、`notification.js`、`options.js` 顶层裸 `await`，为异步操作增设完整的 try/catch 异常捕获与错误提示。
- **theme**: 将 `popup.css` 的 `color-scheme` 修正为 `dark`，匹配实际暗色背景主题。

#### Refactor
- **manifest**: 将 `manifest.json` 迁移至 `src/` 目录，统一扩展加载源路径为 `src/`。
- **docs**: 整合原有分散设计文档至 `README.md`，规范化工程架构文档。

#### Test
- **tdd**: 新增 `tests/service-worker.test.js`（并发死锁复现与跳过调度验证）与 `tests/storage.test.js`（状态清洗验证），全量测试用例增至 16 项且全部通过。
