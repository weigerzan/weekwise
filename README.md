# Weekwise · 拾周

English | [中文](README.zh-CN.md) · v0.1.0

[Download Windows portable build (x64)](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip)

**You know what needs doing. Weekwise helps you decide how much to do each day.**

**Currently supports Windows only. The application UI is in Chinese.**

A Windows desktop task planner powered by DeepSeek. Describe concrete tasks, workloads, and rough deadlines to get daily tasks you can check off. Adjust the plan yourself and record the time you actually spend.

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

To run from source instead, use Windows, Node.js 22.12 or newer, and npm:

```powershell
npm ci
npm start
```

1. Open the settings dialog (「规划设置与备份」). Set your DeepSeek API key, daily availability, and usual work hours. Changes save automatically.
2. Open natural-language planning (「自然语言规划」), describe the work, and generate a plan. Review quantities, dates, and durations before adding tasks.
3. Adjust the board, open the minimal widget (「极简浮窗」), and check off the day's tasks.

AI features use your own DeepSeek API credits. Manual task management works without an API key.

## Data and development

Tasks are stored locally in `%APPDATA%\Weekwise` with JSON backup support. API keys are encrypted by Windows and excluded from task backups. AI requests send the relevant descriptions and task information to DeepSeek. Reminders require the computer to be awake and the application to be running.

```powershell
npm test          # Unit tests with mocked AI responses
npm run package   # Build release/Weekwise-win32-x64; keep the whole folder
```

Application code lives in `src/` and `desktop/`, development scripts in `scripts/`, and tests in `tests/`. Build output, caches, temporary test data, and local credentials are excluded from Git.

[Detailed guide (Chinese)](docs/user-guide.md) · [Changelog](CHANGELOG.md)
