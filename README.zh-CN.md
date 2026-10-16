# 拾周 · Weekwise

[English](README.md) | 中文 · v0.1.1

[下载 Windows 免安装版（x64）](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip)

**你知道要做什么，拾周帮你安排每天做多少。**

**支持 Windows 与 macOS，应用界面为中文。macOS 版本优先面向 Apple Silicon 本机使用。**

一个使用 DeepSeek 规划任务的桌面助手。把明确的任务、工作量和大概时间节点告诉它，生成每天可以打勾的小任务；你随时可以手动修改，并记录实际投入。

![把繁多任务整理成每天可以完成的计划。](docs/assets/what-weekwise-does.png)

## 什么时候用

事情太多，不知道先做哪件；或者需要有人替你安排好每天的任务，帮助自己开始行动。你已经知道具体要做什么，只是需要分配、规划和记录。

例如：

> 我五天内要审7篇稿子，尽量分散；后天下午3–5点开组会；明晚8–9点面试。下周还要改150份卷子，开始不熟悉，前几天少排，后几天多排。

只有远期愿望、还没明确具体工作时，先把任务想清楚。例如「我一月份想投一篇 ICML，告诉我每天要干啥」缺少研究内容、当前进度和待办事项，不适合直接交给拾周生成研究路线。

## 可以做什么

- **自然语言规划与调整**：拆分每日任务，预览后应用；安排一天的大概工作时段。
- **自己掌控计划**：周／月看板、拖动改期与排序、手动编辑、颜色类别。
- **桌面待办与提醒**：完整或极简透明浮窗，完成即隐藏；组会、面试等定时任务可提前提醒。
- **记录投入**：完成时填写实际耗时，查看每日热图与近期曲线；没填实际耗时的完成项按计划耗时统计。

## 开始使用

**免安装版（推荐）：**[下载压缩包](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip)，完整解压后双击 `Weekwise.exe` 或 `启动拾周.cmd` 即可使用，无需安装 Node.js。整个目录需一起保留，请勿单独移动 exe 文件。

如果需要从源码运行，请准备 macOS 或 Windows、Node.js 22.12 或更新版本（建议 Node.js 24 LTS），以及 npm：

```powershell
npm ci
npm start
```

**macOS 本机版：**在 Mac 上执行 `npm run package`，双击 `release/Weekwise-darwin-arm64/Weekwise.app`（Apple Silicon）。也可以把应用复制到“应用程序”文件夹。该构建使用本机临时签名，尚未进行 Developer ID 签名或 Apple 公证，不作为公开发行版。日常打开打包后的应用不需要 Node.js。

Mac 上关闭窗口后应用继续运行，可从 Dock 或菜单栏重新打开；`⌘Q` 完全退出并停止提醒。`⌘N` 新建任务、`⌘K` 搜索、`⌘,` 打开设置。浮窗与提醒窗口设置为在各桌面和全屏空间显示，具体表现需在使用的显示器与桌面布局中验证。

1. 打开「规划设置与备份」，填写 DeepSeek API 密钥、每天可用时间与基础作息。设置自动保存。
2. 点击「自然语言规划」，描述任务，点击「拆分并安排」。检查数量、日期和耗时，再添加每日任务。
3. 在看板中调整安排，打开「极简浮窗」，做完当天任务后打勾。

AI 功能使用你自己的 DeepSeek API 额度；不配置密钥也能手动管理任务。

## 数据与开发

任务默认保存在 Windows 的 `%APPDATA%\Weekwise`，或 macOS 的 `~/Library/Application Support/Weekwise`，支持跨平台 JSON 备份。API 密钥通过操作系统加密保存（Mac 使用钥匙串），不包含在任务备份中；从 Windows 迁入 Mac 后需重新填写密钥。使用 AI 时，相关描述与任务信息会发送给 DeepSeek。提醒需要电脑开机且应用正在运行。

```powershell
npm test          # 单元测试，使用模拟 AI 响应
npm run test:desktop # 桌面回归，隔离测试数据；AI 使用模拟响应
npm run package   # 按本机平台生成 macOS .app 或 Windows 免安装目录
```

测试可用 `WEEKWISE_EXECUTABLE` 指定打包后应用的可执行文件；Mac 路径是 `.app/Contents/MacOS/Weekwise`。桌面测试会短暂显示窗口、使用测试密钥验证系统加密，可能触发钥匙串授权；不会读取正式任务或消耗 DeepSeek 额度。Mac 图标可通过 `npm run icons:mac` 重新生成，需要系统命令行工具。

macOS 验证环境：Sequoia 15.7.1、Apple Silicon arm64，开启台前调度；84 项单元测试与打包版全部 10 组桌面回归通过。其他 Mac 机型、系统版本和多显示器布局尚未逐一验证。

源码在 `src/` 与 `desktop/`，开发脚本在 `scripts/`，测试在 `tests/`。构建产物、缓存、测试临时数据和本机凭据不提交 Git。

[详细使用指南](docs/user-guide.md) · [版本记录](CHANGELOG.md)
