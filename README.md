# 🧠 Antigravity Context Budget Inspector

> **macOS Menu Bar monitor and real-time Precision Telemetry HUD for Google Antigravity 2.0 & Antigravity IDE.**  
> Zero external npm dependencies. 100% native Node.js 22+ with `node:sqlite`.

[![Node.js](https://img.shields.io/badge/node.js-%3E%3D22.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-000000?logo=apple&logoColor=white)](https://apple.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

---

## Overview

In **Google Antigravity 2.0** and **Antigravity IDE**, prompt context adds up quickly:
- **Custom Rules** (`<user_rules>`)
- **Skills Catalog** (`<skills>`)
- **MCP Server tool definitions & schemas** (`<mcp_servers>`)
- **System protocol & Agent guidelines** (`<identity>`, `<planning_mode>`, etc.)
- **Multi-turn conversation history** (Model thinking tokens + response text)

**Antigravity Context Budget** provides instant, non-intrusive visibility into your context consumption:

1. **macOS Menu Bar Pill** (`🧠 294.6k`) via SwiftBar: Live token count updating automatically every 30 seconds with adaptive color thresholds (Safe, Warning, Critical).
2. **Local Precision HUD Dashboard** (`http://127.0.0.1:3456`): Deep breakdown of every rule, skill, and tool schema with real-time search, remaining headroom calculations, and turn-by-turn history.
3. **Automated Lifecycle Integration**: Starts automatically when Antigravity opens, terminates cleanly when Antigravity closes. Zero wasted CPU or background clutter.

---

## ✨ Features

- **⚡ Zero External Dependencies**: Built entirely with Node.js 22+ standard library (`node:sqlite`, `node:child_process`, `node:http`, `node:fs`). No heavy frameworks, zero security vulnerabilities.
- **🔋 Ultra-Lightweight Footprint**: ~0.001% CPU usage (~2ms check intervals) and ~15MB RAM.
- **📊 Precision HUD Dashboard**:
  - Headroom telemetry gauge (remaining tokens before the 1M ceiling).
  - Tabular token breakdown for Rules, Skills, and MCP tools.
  - Interactive search across all components.
  - One-click copy buttons for Session IDs and Rule prompts.
  - Turn timeline visualizing Model Thinking vs User Input vs Tool executions.
- **🔄 Auto Start / Auto Stop**: Managed seamlessly via a lightweight macOS `LaunchAgent` daemon.

---

## 🛠 Prerequisites

1. **macOS** (Apple Silicon or Intel).
2. **Node.js 22+**:
   ```bash
   brew install node
   ```
3. **SwiftBar** (macOS menu bar app runner):
   ```bash
   brew install --cask swiftbar
   ```
4. **Google Antigravity 2.0** or **Antigravity IDE**.

---

## 🚀 Quickstart (One-Command Setup)

Clone the repository and run the universal setup script:

```bash
git clone https://github.com/theodelaporte/antigravity-context-budget.git
cd antigravity-context-budget

npm run setup
```

### What `npm run setup` does automatically:
1. Detects your exact Node.js interpreter path and configures `tracker.30s.js`.
2. Creates the symlink inside `~/Library/Application Support/SwiftBar/plugins/`.
3. Sets SwiftBar preferences to prevent directory clutter.
4. Generates and registers the macOS `LaunchAgent` (`com.antigravity.context-budget`).
5. Starts the monitor immediately if Antigravity is already open.

---

## 📋 Useful Commands

```bash
# Check the real-time status of all components
npm run daemon:status

# Open the Web Dashboard manually
npm start
# -> http://127.0.0.1:3456

# Reinstall or restart the background service
npm run daemon:restart

# Complete uninstall (removes LaunchAgent and SwiftBar symlink)
npm run uninstall
```

---

## 🏗 Architecture

```
┌────────────────────────────────────────────────────────┐
│ macOS LaunchAgent (com.antigravity.context-budget)    │
│ Starts on login · Runs lightweight daemon              │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
             ┌───────────────────────────┐
             │   Daemon (src/daemon.js)  │
             │   Lightweight pgrep loop  │
             └─────────────┬─────────────┘
                           │
         Is Antigravity App or IDE running?
               │                       │
      YES      ▼                       ▼      NO
┌──────────────────────────┐     ┌──────────────────────────┐
│ - Spawns server.js       │     │ - Kills server.js        │
│ - Opens SwiftBar (-g)    │     │ - Quits SwiftBar         │
│ - tracker.30s.js active  │     │ - Zero active processes  │
└──────────────────────────┘     └──────────────────────────┘
```

---

## 🔒 Security & Privacy

- **100% Local**: No external network calls, no analytics, no data sent to cloud servers.
- **Localhost Only**: Web dashboard binds strictly to `127.0.0.1:3456`.
- **Hardened HTTP Headers**: Strict `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- **Read-Only SQLite**: Extracts metadata using native `node:sqlite` in read-only mode, guaranteeing zero corruption of Antigravity session files.

---

## 📄 License

MIT License © 2026 [Theo Delaporte](https://github.com/theodelaporte). See [LICENSE](LICENSE) for details.
