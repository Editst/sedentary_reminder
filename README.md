# 久坐提醒 Time Reminder

一个基于 Chrome Extension Manifest V3 的办公久坐提醒插件，用来在专注工作一段时间后提醒你起身活动、喝水或短暂休息。

## 功能特性

- 支持工作、短休息、长休息三段节奏切换
- 支持自定义工作时长、短休息时长、长休息时长
- 支持设置“每几次短休息后进入一次长休息”
- 支持系统通知 + 插件提醒页双提醒方式
- 支持提醒页自动关闭时长配置
- 支持贪睡（Snooze）延后提醒，多档位动态渲染
- 支持暂停、恢复、延后、跳过本次、测试提醒
- 支持扩展图标 Action Badge 实时状态与剩余时间提示（工作倒计时/休息/暂停/到期）
- 支持浏览器重启后恢复运行状态
- 支持单实例提醒窗口，避免重复弹出多个提醒页
- 支持提醒窗口超时/关闭后自动兜底延后调度，彻底杜绝定时器假死
- 支持全局启用/停用开关

## 界面

| 界面 | 用途 |
|------|------|
| 设置页 | 修改提醒节奏、启用开关、提醒文案、自动关闭时长等配置；支持恢复默认和发送测试提醒 |
| 状态弹窗 | 查看当前阶段与剩余时间、长休息循环进度、提醒窗口状态；提供情境快捷操作（提前结束休息、立即开始休息）与快速暂停/恢复 |
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
| `shared/timer_engine.js` | 纯状态机：阶段流转（work → break → work）、暂停/恢复、延后计算 |
| `shared/storage.js` | 存储抽象：读写设置与状态、数据归一化、内存回退 |
| `shared/validation.js` | 输入校验：数值范围统一钳位、字符串截断、延后选项去重/排序/过滤 |
| `background/service-worker.js` | 调度核心：alarm 处理、系统通知、提醒窗口管理、Action Badge 更新、消息路由、状态串行锁 |
| `popup/` | 工具栏弹窗：状态展示、情境操作（结束/开始休息）、暂停/恢复/测试操作 |
| `options/` | 设置页：表单读写、保存/重置/测试 |
| `notification/` | 提醒页：自动关闭倒计时、开始休息/延后/跳过操作、DOM 缓存优化 |

### 数据模型

#### UserSettings

| 字段 | 类型 | 默认值 | 范围 |
|------|------|--------|------|
| `enabled` | boolean | `true` | — |
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
                       ├─ skip ──→ work（重置工作计时器，开启新的完整工作周期）
                       └─ 超时/关闭未操作 ──→ 自动安排兜底延后 (默认5分钟) ──→ 再次提醒

任意活动状态 ──pause──→ paused ──resume──→ 恢复之前的模式与剩余时间
```

## 本地使用

### 1. 运行测试

```bash
npm test
```

当前项目测试基于 Node 24 原生测试能力，不依赖额外测试包。

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
│  ├─ shared/             # 常量、校验、存储、计时逻辑
│  │  ├─ constants.js
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
├─ tests/                 # Node 24 原生测试
│  ├─ service-worker.test.js  # 状态机/并发/调度/生命周期集成测试
│  ├─ storage.test.js         # 状态归一化与字段清洗
│  ├─ timer-engine.test.js    # 阶段流转纯函数测试
│  └─ validation.test.js      # 配置校验/钳位/排序逻辑测试
├─ CHANGELOG.md
├─ ROADMAP.md
└─ README.md
```

## 测试状态

当前自动化测试覆盖（26 项用例，全部通过）：

- 配置校验逻辑（默认值回退、统一边界钳位、延后选项去重升序排序）
- 工作 / 短休息 / 长休息切换逻辑
- 延后提醒逻辑与暂停清零
- `canEndBreak` / `canStartBreak` 条件判定（无需提醒页打开）
- `withStateLock` 死锁预防（嵌套调用不阻塞）
- `handleSkip` 调度计算（按完整工作时长重置）
- 测试提醒无损关闭（关闭测试提醒不破坏进行中的工作会话进度）
- 提醒页关闭兜底 Alarm 调度（超时或关闭后自动延后，防止扩展假死）
- 休息会话到期通知触发与状态流转
- Action Badge 状态与徽标文字同步
- `handleResume` 后 `snoozedUntil` 清零
- `handleSaveSettings` 在 `preserveSessionEnd` 激活时仍正确应用新设置
- `scheduleMainAlarm` NaN 输入防护
- `tabs.onRemoved` 事件的状态清理
- 存储状态归一化与未知属性过滤
