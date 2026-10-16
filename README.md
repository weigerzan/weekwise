# Weekwise · 拾周

English | [中文](README.zh-CN.md) · v0.1.1

[Download Windows portable build (x64)](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip) · [Download Mac test build (Apple Silicon)](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.1-macos-arm64.zip) · [Build for Mac from source](#build-from-source-on-macos)

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

**Windows portable build:** [Download the ZIP](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.0-windows-x64.zip), extract the whole folder, and double-click `Weekwise.exe` or `启动拾周.cmd`. No installation or Node.js is required. Keep the executable and all accompanying files together.

**macOS test build:** [download the Mac ZIP](https://github.com/weigerzan/weekwise/releases/download/v0.1.0/Weekwise-v0.1.1-macos-arm64.zip) and follow the [direct installation instructions](#use-the-macos-app-from-releases). You can also [build `Weekwise.app` from source](#build-from-source-on-macos).

On macOS, closing every window leaves the menu-bar app running. Reopen from the Dock or status menu; use `⌘Q` to quit and stop reminders. `⌘N` creates a task, `⌘K` searches, and `⌘,` opens settings. Floating windows are configured to appear across Spaces, including full-screen Spaces; verify their behavior with your display setup.

1. Open the settings dialog (「规划设置与备份」). Set your DeepSeek API key, daily availability, and usual work hours. Changes save automatically.
2. Open natural-language planning (「自然语言规划」), describe the work, and generate a plan. Review quantities, dates, and durations before adding tasks.
3. Adjust the board, open the minimal widget (「极简浮窗」), and check off the day's tasks.

AI features use your own DeepSeek API credits. Manual task management works without an API key.

## Use the macOS app from Releases

The existing [Weekwise v0.1.0 Release](https://github.com/weigerzan/weekwise/releases/tag/v0.1.0) includes `Weekwise-v0.1.1-macos-arm64.zip`. This attachment is a **Mac test build, app version 0.1.1**, built from the `macos` branch. The original Windows build and `v0.1.0` tag are unchanged. GitHub's automatically generated “Source code” archives contain source files; download the app ZIP containing `macos-arm64` in its name instead.

- **Hardware:** Apple Silicon Macs (M series), not Intel Macs. Verified on macOS Sequoia 15.7.1; other OS versions have not been tested on hardware.
- **No development tools needed:** Node.js, Electron, Xcode, and an Apple Developer account are not required.
- **Signing:** ad-hoc signed, without Developer ID signing or Apple notarization. macOS may block the first launch.

Installation and first launch:

1. Download and unzip the archive, then drag the complete `Weekwise.app` into Applications. You do not need to open the app bundle to find an executable.
2. Double-click to launch. If macOS says the developer cannot be verified or Apple cannot check for malicious software, dismiss the alert.
3. Once you have confirmed the download is from this repository and has not been tampered with, open **System Settings → Privacy & Security**, find Weekwise, click **Open Anyway**, and confirm as prompted. After approval, you can usually launch it by double-clicking. [Apple instructions](https://support.apple.com/102445)
4. Enter your own DeepSeek API key in settings (「规划设置与备份」) and wait for it to save automatically. Skip this for manual task management.

If “Open Anyway” is unavailable or macOS reports a damaged file, download it again and compare its SHA-256 with the Release notes. If the issue persists, build from source on your Mac using the steps below. Organization-managed Macs may restrict app overrides; follow your organization's policies.

## Build from source on macOS

Other Mac users can download the `macos` branch and build on their own machine. A paid Apple Developer account is not required, and you do not need to compile Electron itself. npm downloads the project dependencies and prebuilt Electron runtime; the packaging script bundles the runtime into a standalone `.app`.

### 1. Prepare your Mac

- **System:** verified on macOS Sequoia 15.7.1 with Apple Silicon. Other OS versions and Intel Macs have not been tested on hardware.
- **Command-line tools:** install Apple Command Line Tools for Git and related tools; full Xcode is not required. If they are missing, run the command below in Terminal and wait for the system installer to finish. If already installed, continue to the next step. [Apple installation guide](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/)
- **Node.js and npm:** install Node.js 24 LTS, including npm, from the [Node.js website](https://nodejs.org/en/download). The minimum supported Node.js version is 22.12. Use native arm64 Node.js on Apple Silicon and x64 on Intel.

```bash
xcode-select --install
```

Open a new Terminal window after installation and check the environment:

```bash
git --version
node --version
npm --version
node -p 'process.arch'
```

The last command should print `arm64` on Apple Silicon or `x64` on Intel. The build uses the architecture of Node.js. On Apple Silicon, use native Node.js and turn off Terminal's “Open using Rosetta” option to avoid building an Intel app.

### 2. Download and build

Run these commands in the directory where you want to keep the project:

```bash
git clone --branch macos --single-branch https://github.com/weigerzan/weekwise.git
cd weekwise
npm ci
npm run package
open release
```

`npm ci` installs the development and packaging dependencies from the committed lockfile; do not add `--omit=dev`. The first build also downloads Electron, which may take time depending on your connection. On success, Finder opens the `release` folder:

| Local Node.js architecture | Generated application |
| --- | --- |
| `arm64` (Apple Silicon) | `release/Weekwise-darwin-arm64/Weekwise.app` |
| `x64` (Intel) | `release/Weekwise-darwin-x64/Weekwise.app` (not yet tested on hardware) |

Drag `Weekwise.app` into Applications and double-click it to launch. The packaged app includes its runtime and does not need Node.js or the source directory for everyday use. Icons are already included in the repository; you do not need to regenerate them.

The script automatically applies and verifies an ad-hoc signature, without Developer ID signing or Apple notarization. Building for your own Mac does not require purchasing a certificate. Sharing the resulting app as a download may still trigger macOS security prompts. If macOS blocks it, follow [Apple's first-launch instructions](https://support.apple.com/102445) only when you trust its source and know it has not been tampered with.

On first launch, enter your own DeepSeek API key in settings (「规划设置与备份」) and allow it to save automatically. No API key is included in the source or build; do not put it in source files or an `.env` file. Manual task management works without a key.

### 3. Run during development or update

To launch directly from source, run `npm start` in the project directory; packaging is optional. Development and packaged versions share the local task directory. Quit the running version with `⌘Q` before switching to avoid concurrent writes. Their Keychain identities may differ; re-enter your key in settings if decryption fails after switching.

To update your clone, export a task backup in the app and quit it, then run these commands in the project directory:

```bash
git pull --ff-only
npm ci
npm run package
open release
```

Replace the old app in Applications with the newly built `.app`. Tasks are stored outside the source directory and are not deleted by rebuilding. Preserve any source changes you have made before updating.

### If Electron downloads are slow

From the project directory, use the [mirror listed in Electron's documentation](https://www.electronjs.org/docs/latest/tutorial/installation#mirror):

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_CUSTOM_DIR='{{ version }}'
node node_modules/electron/install.js
npm run package
```

## Data and development

Running from source on Windows also uses Node.js 24 LTS (minimum 22.12) and npm. After cloning the repository, run `npm ci` followed by `npm start` in the project directory.

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
