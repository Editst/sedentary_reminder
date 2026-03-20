# 久坐提醒

一个可直接从仓库根目录加载的 Chrome MV3 扩展，用于专注计时、起身活动提醒和短休息/长休息切换。

## 功能概览

- 专注工作、短休息、长休息三种状态循环
- 到点后同时发送系统通知并打开提醒页
- 支持暂停、恢复、延后 5/10 分钟、跳过、测试提醒
- 设置保存在 `chrome.storage.sync`，运行状态保存在 `chrome.storage.local`
- 弹出页可查看当前状态，设置页可直接调整提醒策略
- 提醒页采用单实例策略：正式提醒和测试提醒都会复用同一个提醒窗口

## 作为未打包扩展加载

1. 打开 Chrome，进入 `chrome://extensions`
2. 开启右上角的开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择仓库根目录：`D:\Documents\time_reminder`

当前仓库无需构建步骤，`manifest.json` 直接指向 `src/` 下的扩展文件。

## 主要设置项

- 专注时长
- 短休息时长
- 长休息时长
- 长休息频率
- 提醒页自动关闭时间
- 休息倒计时长度
- 延后选项
- 提醒标题和提醒内容

## 脚本

- `npm test`：运行 Vitest 测试
- `npm run build`：输出“从仓库根目录直接加载”的说明

## 目录说明

- `src/background/service-worker.js`：后台调度、通知和提醒窗口管理
- `src/shared/*`：共享常量、校验、存储和计时逻辑
- `src/options/*`：设置页
- `src/popup/*`：工具栏弹出页
- `src/notification/*`：提醒页
- `src/assets/icons/*`：扩展图标资源
