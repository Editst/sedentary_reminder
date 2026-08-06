# 久坐提醒 Time Reminder

一个基于 Chrome Extension Manifest V3 的办公久坐提醒插件，用来在专注工作一段时间后提醒你起身活动、喝水或短暂休息。

## 功能特性

- 支持工作、短休息、长休息三段节奏切换
- 支持自定义工作时长、短休息时长、长休息时长
- 支持设置"每几次短休息后进入一次长休息"
- 支持系统通知 + 插件提醒页双提醒方式
- 支持提醒页自动关闭时长配置
- 支持休息倒计时配置
- 支持暂停、恢复、延后、跳过本次、测试提醒
- 支持浏览器重启后恢复运行状态
- 支持单实例提醒窗口，避免重复弹出多个提醒页
- 支持全局启用/停用开关

## 界面

| 界面 | 用途 |
|------|------|
| 设置页 | 修改提醒节奏、启用开关、提醒文案、自动关闭时长等配置；支持恢复默认和发送测试提醒 |
| 状态弹窗 | 查看当前阶段与剩余时间、长休息循环进度、提醒窗口状态；快速暂停或恢复 |
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
| `shared/validation.js` | 输入校验：数值范围钳位、字符串截断、延后选项过滤 |
| `background/service-worker.js` | 调度核心：alarm 处理、系统通知、提醒窗口管理、消息路由、状态串行锁 |
| `popup/` | 工具栏弹窗：状态展示、暂停/恢复/测试操作 |
| `options/` | 设置页：表单读写、保存/重置/测试 |
| `notification/` | 提醒页：自动关闭倒计时、开始休息/延后/跳过操作 |

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
| `breakCountdownSeconds` | int | 300 | 10–7200 |
| `snoozeMinutesOptions` | int[] | [5, 10] | 每项 1–60，最多 3 项 |
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

### 状态流转

```text
work ──(到期)──→ 提醒页 ──startBreak──→ shortBreak/longBreak ──(倒计时结束)──→ work
                       ├─ snooze ──→ (延后到期后再次提醒)
                       └─ skip ──→ work（保持当前阶段，短暂冷却后继续）

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
│  ├─ background/         # 后台调度与窗口管理
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
│  ├─ timer-engine.test.js
│  └─ validation.test.js
└─ README.md
```

## 测试状态

当前自动化测试覆盖：

- 配置校验逻辑（默认值回退、数值钳位、延后选项过滤）
- 工作 / 短休息 / 长休息切换逻辑
- 延后提醒逻辑

## 设计决策

- **纯 JS 而非 TypeScript**：初始设计文档指定 TypeScript + Vite + Vitest，实际实现选择原生 JS + ES Modules，省去构建步骤，降低维护成本，可直接从 `src/` 加载为 unpacked extension。
- **`chrome.storage.sync` 与 `local` 分离**：设置跨设备同步，运行状态仅本机持久化。
- **纯函数状态机**：计时逻辑集中在 `timer_engine.js`，不依赖 Chrome API，便于单元测试。
- **状态操作串行锁**：`service-worker.js` 中所有修改状态的操作通过 `withStateLock` 串行化，防止并发消息导致的 read-modify-write 竞态。
- **单实例提醒窗口**：通过 tab query + normalize 策略确保同时只有一个提醒窗口。

## 后续可扩展方向

- 工作时段限制（仅在指定时间段内启用提醒）
- 更丰富的提醒文案模板
- 历史提醒记录与统计
- 多套节奏预设（番茄钟 25/5、深度工作 50/10 等）
- 国际化（`chrome.i18n`）
- 自定义提示音
- 亮色/暗色主题切换

## License

当前仓库未单独声明许可证；如需开源发布，建议补充 `LICENSE` 文件。
