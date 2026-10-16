# Weekwise · 拾周

English | [中文](README.zh-CN.md) · v0.1.1

[Download Windows portable build (x64)](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip)

**You know what needs doing. Weekwise helps you decide how much to do each day.**

**Supports Windows and macOS. The application UI is in Chinese. The macOS build initially targets local use on Apple Silicon.**

A desktop task planner powered by DeepSeek. Describe concrete tasks, workloads, and rough deadlines to get daily tasks you can check off. Adjust the plan yourself and record the time you actually spend.

![Turn a busy workload into a clear plan for each day.](docs/assets/what-weekwise-does.png)

## When to use it

You have too much to do and struggle to arrange it, or you need an external plan to help you get started. You already know the work; you need help distributing, scheduling, and tracking it.

For example:

> Review 7 papers within 5 days, spread them out. There is a group meeting from 3–5 pm the day after tomorrow and an interview from 8–9 pm tomorrow. Next week, grade 150 exams: fewer at first while I learn, then more as I get faster.

If all you have is a distant ambition, define the work first. “I want to submit an ICML paper in January; tell me what to do every day” lacks the research direction, current progress, and concrete tasks needed for a useful plan. Weekwise is intended to organize known work rather than invent a research roadmap.

## Features

- **Plan and revise in natural language:** create daily tasks, preview changes, and suggest work sessions for a day.
- **Stay in control:** weekly/monthly boards, drag to reschedule or reorder, manual editing, and custom color categories.
- **Desktop tasks and reminders:** full or minimal transparent widgets; completed tasks disappear. Add advance reminders for scheduled events.
- **Track your effort:** record actual time at completion and view a daily heatmap and recent trend. Completed tasks without actual time use their planned duration in statistics.

## Get started

**Portable build (recommended):** [Download the ZIP](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip), extract the whole folder, and double-click `Weekwise.exe` or `启动拾周.cmd`. No installation or Node.js is required. Keep the executable and all accompanying files together.

To run from source instead, use macOS or Windows, Node.js 22.12 or newer (Node.js 24 LTS recommended), and npm:

```powershell
npm ci
npm start
```

**macOS local build:** run `npm run package` on your Mac, then open `release/Weekwise-darwin-arm64/Weekwise.app` on Apple Silicon. You may copy the app to Applications. The build is ad-hoc signed for local use, without Developer ID signing or Apple notarization. The packaged app does not need Node.js installed.

On macOS, closing every window leaves the menu-bar app running. Reopen from the Dock or status menu; use `⌘Q` to quit and stop reminders. `⌘N` creates a task, `⌘K` searches, and `⌘,` opens settings. Floating windows are configured to appear across Spaces, including full-screen Spaces; verify their behavior with your display setup.

1. Open the settings dialog (「规划设置与备份」). Set your DeepSeek API key, daily availability, and usual work hours. Changes save automatically.
2. Open natural-language planning (「自然语言规划」), describe the work, and generate a plan. Review quantities, dates, and durations before adding tasks.
3. Adjust the board, open the minimal widget (「极简浮窗」), and check off the day's tasks.

AI features use your own DeepSeek API credits. Manual task management works without an API key.

## Data and development

Tasks are stored locally in `%APPDATA%\Weekwise` on Windows or `~/Library/Application Support/Weekwise` on macOS, with cross-platform JSON backup support. API keys use OS encryption (Keychain on macOS) and are excluded from task backups. Enter your key again after moving between operating systems. AI requests send the relevant descriptions and task information to DeepSeek. Reminders require the computer to be awake and the application to be running.

```powershell
npm test          # Unit tests with mocked AI responses
npm run test:desktop # Isolated desktop regression tests; mocked AI responses
npm run package   # Build a macOS .app or Windows portable folder on the host OS
```

Set `WEEKWISE_EXECUTABLE` to test a packaged executable (`.app/Contents/MacOS/Weekwise` on Mac). Desktop tests show temporary windows and use fake keys to verify OS encryption, which may prompt for Keychain access. They do not read production tasks or spend API credits. Regenerate the Mac icons with `npm run icons:mac` (requires macOS command-line tools).

Validated on macOS Sequoia 15.7.1, Apple Silicon arm64, with Stage Manager enabled: all 84 unit tests and all 10 packaged desktop regression suites pass. Other Mac hardware, OS versions, and multi-display arrangements have not been individually verified.

Application code lives in `src/` and `desktop/`, development scripts in `scripts/`, and tests in `tests/`. Build output, caches, temporary test data, and local credentials are excluded from Git.

[Detailed guide (Chinese)](docs/user-guide.md) · [Changelog](CHANGELOG.md)
