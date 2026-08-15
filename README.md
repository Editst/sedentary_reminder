# 久坐提醒 Time Reminder

一个基于 Chrome Extension Manifest V3 的办公久坐提醒插件，用来在专注工作一段时间后提醒你起身活动、喝水或短暂休息。

## 功能特性

- 支持工作、短休息、长休息三段节奏切换
- 支持自定义工作时长、短休息时长、长休息时长
- 支持设置“每几次短休息后进入一次长休息”（跳过休息亦会计入长休息进度）
- 支持**生效时间范围**（`scheduleStartTime` 至 `scheduleEndTime`）与**工作日星期多选**（周一至周日），非生效时段静默休眠并自动定时唤醒
- 支持系统通知 + 插件提醒页双提醒方式
- 支持提醒页自动关闭时长配置
- 支持贪睡（Snooze）延后提醒，多档位动态渲染
- 支持暂停、恢复、延后、跳过本次、测试提醒
- 支持扩展图标 Action Badge 实时状态与剩余时间提示（工作倒计时/休息/暂停/到期/休眠 `ZZZ`/关闭 `OFF`）
- 支持浏览器重启后恢复运行状态
- 支持单实例提醒窗口与前台聚焦唤醒（`focused: true`, `drawAttention: true`），避免重复弹出多个提醒页
- 支持提醒窗口超时/关闭后自动兜底延后调度，彻底杜绝定时器假死
- 支持底层 `Promise.race` 并发状态锁熔断保护，防止异常操作造成的系统全局挂起
- 支持全局启用/停用开关与冷启动重置保护

## 界面

| 界面 | 用途 |
|------|------|
| 设置页 | 修改提醒节奏、生效时段与星期、启用开关、提醒文案、自动关闭时长等配置；支持恢复默认和发送测试提醒 |
| 状态弹窗 | 查看当前阶段与剩余时间、生效时段状态、长休息循环进度、提醒窗口状态；提供情境快捷操作（提前结束休息、立即开始休息）与快速暂停/恢复 |
| 提醒页 | 到点后执行开始休息、延后提醒、跳过等操作；显示自动关闭倒计时与进度条 |

## 技术架构

### 技术栈

| 类别 | 选型 | 备注 |
|------|------|------|
| 平台 | Chrome Extension Manifest V3 | 遵循最新扩展标准 |
| 语言 | JavaScript (ES Modules) | 无构建步骤，直接加载 |
| 后台调度 | Service Worker | MV3 唯一后台方案 |
| 定时 | `chrome.alarms` | MV3 可靠定时 API |
| 配置存储 | `chrome.storage.sync` | 跨设备同步 |
| 运行状态 | `chrome.storage.local` | 仅本机 |
| 测试 | Node 24 原生 `node:test` | 无额外依赖 |

### 模块划分

| 模块 | 职责 |
|------|------|
| `shared/constants.js` | 模式枚举、消息类型、存储键名、默认设置与默认状态 |
| `shared/timer_engine.js` | 纯状态机：阶段流转（work → break → work）、时段判定（`isWithinSchedule`）、下次生效时间计算（`getNextScheduleStartTime`）、格式解析 |
| `shared/storage.js` | 存储抽象：读写设置与状态、数据归一化、内存回退 |
| `shared/validation.js` | 输入校验：数值范围统一钳位、字符串截断、延后选项去重/排序/过滤、时段与空星期异常阻断 |
| `background/service-worker.js` | 调度核心：alarm 处理、时段调度、系统通知、提醒窗口管理、Action Badge 更新、消息路由、状态串行锁 |
| `popup/` | 工具栏弹窗：状态展示、时段休眠展示、情境操作（结束/开始休息）、暂停/恢复/测试操作 |
| `options/` | 设置页：表单读写、时段与星期配置、保存/重置/测试 |
| `notification/` | 提醒页：自动关闭倒计时、开始休息/延后/跳过操作、DOM 缓存优化 |

### 数据模型

#### UserSettings

| 字段 | 类型 | 默认值 | 范围 |
|------|------|--------|------|
| `enabled` | boolean | `true` | — |
| `scheduleEnabled` | boolean | `false` | — |
| `scheduleStartTime` | string | `09:00` | `HH:MM` 格式 |
| `scheduleEndTime` | string | `18:00` | `HH:MM` 格式 |
| `scheduleDays` | int[] | `[1, 2, 3, 4, 5]` | 0（周日）~ 6（周六）数组 |
| `workMinutes` | int | 45 | 1–240 |
| `shortBreakMinutes` | int | 5 | 1–60 |
| `longBreakMinutes` | int | 15 | 1–120 |
| `longBreakEvery` | int | 4 | 1–12 |
| `reminderAutoCloseSeconds` | int | 30 | 5–300 |
| `snoozeMinutesOptions` | int[] | [5, 10] | 每项 1–60，自动去重升序，最多 3 项 |
| `reminderTitle` | string | 该起身活动了 | ≤80 字符 |
| `reminderBody` | string | 站起来走一走… | ≤200 字符 |

#### TimerState

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | enum | `work` · `shortBreak` · `longBreak` · `paused` |
| `previousMode` | enum | 暂停前的模式，用于恢复 |
| `cycleCount` | int | 当前短休息累计次数 |
| `currentSessionStart` | timestamp | 当前阶段开始时间 |
| `currentSessionEnd` | timestamp | 当前阶段结束时间 |
| `lastReminderAt` | timestamp | 上次提醒触发时间 |
| `snoozedUntil` | timestamp | 延后到期时间 |
| `notificationOpen` | boolean | 提醒窗口是否打开 |
| `notificationTabId` | int \| null | 提醒窗口标签页 ID |
| `reminderKind` | string \| null | 提醒种类（`due` · `test`） |

### 状态流转

```text
work ──(到期)──→ 提醒页 ──startBreak──→ shortBreak/longBreak ──(到期/提前结束)──→ 发出休息结束通知 ──→ work
                       ├─ snooze ──→ (延后到期后再次提醒)
                       ├─ skip ──→ work（重置工作计时器，开启新的完整工作周期，并推进长休息循环进度）
                       └─ 超时/关闭未操作 ──→ 自动安排兜底延后 (默认5分钟) ──→ 再次提醒

任意活动状态 ──pause──→ paused ──resume──→ 恢复之前的模式与剩余时间
非生效时段 ──休眠──→ 调度精确唤醒 Alarm ──到点──→ 进入全新工作周期
```

## 本地使用

### 1. 运行测试

```bash
node --test
```

当前项目完全基于 Node 原生测试运行器（`node:test`），零第三方 npm 依赖，不需要 `package.json`。

### 2. 以开发者模式加载扩展

1. 打开 Chrome，进入 `chrome://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `src/` 目录（`manifest.json` 位于此处）

> **注意**：`manifest.json` 位于 `src/` 目录下，加载扩展时应选择 `src/` 而非项目根目录。

## 项目结构

```text
time_reminder/
├─ src/
│  ├─ manifest.json       # 扩展清单（加载扩展时选择 src/ 目录）
│  ├─ background/         # 后台调度、Action Badge 与窗口管理
│  │  └─ service-worker.js
│  ├─ shared/             # 常量、校验、存储、消息通信与时段算法
│  │  ├─ constants.js
│  │  ├─ messaging.js
│  │  ├─ timer_engine.js
│  │  ├─ storage.js
│  │  └─ validation.js
│  ├─ options/            # 设置页
│  │  ├─ options.html
│  │  ├─ options.js
│  │  └─ options.css
│  ├─ popup/              # 状态弹窗
│  │  ├─ popup.html
│  │  ├─ popup.js
│  │  └─ popup.css
│  ├─ notification/       # 提醒页
│  │  ├─ notification.html
│  │  ├─ notification.js
│  │  └─ notification.css
│  └─ assets/icons/       # 扩展图标 16/32/48/128
├─ tests/                 # Node 原生测试
│  ├─ messaging.test.js       # 跨模块消息发送与错误包装测试
│  ├─ service-worker.test.js  # 状态机/并发/调度/生命周期集成测试
│  ├─ storage.test.js         # 状态归一化与字段清洗
│  ├─ timer-engine.test.js    # 阶段流转纯函数与时段算法测试
│  └─ validation.test.js      # 配置校验/钳位/排序/时段配置测试
├─ CHANGELOG.md           # 演进路线规划 (Roadmap) 与版本变更历史 (Changelog)
└─ README.md
```

## 测试状态

当前自动化测试覆盖（98 项用例，全部通过）：

- 配置校验逻辑（默认值回退、统一边界钳位、延后选项多分隔符清洗与去重升序排序、时段与星期格式校验）
- 工作 / 短休息 / 长休息切换逻辑
- 生效时段判定（同日时段、跨午夜时段、跨周末计算与下次生效时间戳瞄准）
- 时长与倒计时格式化纯函数（`formatDurationMs`, `formatSeconds`）
- 跨模块消息通信异常包装与 Promise 解析处理（`sendExtensionMessage`）
- 恢复工作会话起止时间精确校准（防止跨天暂停导致进度条分母失真）
- 提醒页在非生效时段关闭自动休眠调度（`tabs.onRemoved` 时段感知）
- `normalizeState` 缺省与空配置安全回退
- 延后提醒逻辑与暂停清零
- `canEndBreak` / `canStartBreak` 条件判定（无需提醒页打开）
- `withStateLock` 死锁预防（嵌套调用不阻塞）与 `5000ms` 超时熔断及底层异常恢复机制
- `handleSkip` 调度计算（按完整工作时长重置，并累加长休息 `cycleCount`）
- 测试提醒无损关闭（关闭测试提醒不破坏进行中的工作会话进度）
- 提醒页关闭兜底 Alarm 调度（超时或关闭后自动延后，防止扩展假死）
- 到期状态下调用 `getStatus` 的 Alarm 自动保留与防假死
- 休息会话到期通知触发与状态流转
- Action Badge 状态与徽标文字同步（倒计时/状态标记/ZZZ/OFF）
- 停用数天后重新启用的全新工作周期冷启动初始化
- 窗口激活与 Windows 任务栏闪烁（`focused: true`, `drawAttention: true`）
- 点击通知横幅自动清理托盘
- `handleResume` 后 `snoozedUntil` 清零
- `handleSaveSettings` 在 `preserveSessionEnd` 激活时仍正确应用新设置
- `scheduleMainAlarm` NaN 输入防护
- `tabs.onRemoved` 事件的状态清理
- 存储状态归一化与未知属性过滤
- 空星期选择 (`scheduleDays`) 的严格异常阻断防线
- `time-reminder-badge-tick` 周期同步刷新机制与休眠释放
- 延后提醒 `snoozedUntil` 在多场景（测试提醒/保存设置/UI关闭）下的防篡改与正确保持
- CQS (命令查询分离) 原则检查：`getStatus` 零副作用写入断言
- `manifest.json` 安全防护：零 `web_accessible_resources` 暴露特征断言
