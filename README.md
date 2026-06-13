# TabFlow: Smart Tab Auto-Grouper

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**TabFlow** is a modern, high-performance Chrome Extension (Manifest V3) designed to dynamically solve "tab hoard overload." Instead of cluttering your browser window, TabFlow monitors your active workspace and automatically organizes tabs into neat, color-coded native tab groups when they cross a customizable threshold.

Featuring a **glassmorphic dark-mode dashboard** and a **rules categorization engine**, TabFlow helps developers, writers, and power-users regain mental clarity without changing their browsing habits.

---

## ✨ Features

- **⚡ Automated Threshold Triggering**: Avoids grouping tabs unnecessarily. The auto-grouper only activates once you exceed a specified threshold of open tabs (e.g., 8 tabs) in a single window.
- **📁 Smart Category Engine**: Automatically places tabs in standard buckets (`Development`, `Work & Docs`, `Entertainment`, `Social & Chat`, etc.) based on URL hostnames and titles.
- **🛠️ Custom Rules Editor**: Create your own categories, assign them standard Chrome tab colors, and input custom keyword or domain matching criteria.
- **🛡️ Custom Domain Whitelisting**: Exclude highly critical sites (e.g., mail clients, calendars, communication tools) from being grouped so they remain visible on your tab bar.
- **🔽 Inactive Tab Collapse**: Optimizes screen space by automatically expanding only the folder containing your active tab, collapsing all idle ones.
- **🎨 Glassmorphic UI Dashboard**: A premium, visually stunning popup dashboard featuring a dynamic SVG circle gauge indicating current tab density relative to your threshold limits.

---

## 🛠️ Tech Stack & Architecture

- **Extension Specification**: Manifest V3 (Chrome, Edge, Brave, Opera, Arc)
- **Background Engine**: Service Worker (ES modules architecture, event-driven architecture, event debouncing)
- **State Management**: Asynchronous browser storage API (`chrome.storage.local`)
- **Styling & Components**: Vanilla CSS with custom properties (CSS variables), glassmorphism design system, linear gradients, and micro-animations
- **Data Flow**: Message passing between the UI components (Popup / Options) and the background service worker

```
┌────────────────────────────────────────────────────────┐
│                    Chrome Browser                      │
└──────────────────────────┬─────────────────────────────┘
                           │
    Tab Events (Created, Updated, Removed, Activated)
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│         background.js (Service Worker)                 │
│  - Debounces rapid tab loads                           │
│  - Sweeps active windows & queries rules.js            │
│  - Executes chrome.tabs.group & chrome.tabGroups       │
└──────────▲───────────────────────────────────▲─────────┘
           │                                   │
     Message Passing                     Message Passing
           │                                   │
           ▼                                   ▼
┌──────────────────────┐            ┌────────────────────┐
│      popup.html      │            │    options.html    │
│  - Tab Gauge Ring    │            │  - Custom Rules    │
│  - Action Triggers   │            │  - Whitelist Panel │
│  - Settings Sliders  │            │  - Developer Notes │
└──────────────────────┘            └────────────────────┘
```

---

## 🚀 Installation

Since this is a custom extension, you can run it locally in developer mode:

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/sierra9274/tabflow.git
   ```
2. Open your web browser (Google Chrome, Microsoft Edge, Brave, or Arc).
3. Navigate to the extension manager page:
   - Google Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
4. Toggle the **Developer mode** switch (usually in the top right corner).
5. Click **Load unpacked** (top left corner).
6. Select the folder containing the repository files (the directory containing `manifest.json`).
7. **TabFlow** is now active! Pin it to your browser toolbar to access the dashboard.

---

## 📁 Repository Structure

```
tabflow/
├── manifest.json         # Extension definition & permission declarations
├── background.js         # Event listener service worker (processes group actions)
├── rules.js              # Shared categorization rules and storage helpers
├── popup.html            # Main dashboard popup template
├── popup.js              # Interactivity logic for the popup (gauge progress)
├── popup.css             # Glassmorphic, dark-theme styles for popup dashboard
├── options.html          # Advanced settings panel workspace
├── options.js            # Settings page controller (modals, rule configurations)
├── options.css           # Styling sheets for the options dashboard layout
└── icons/                # Extension branding assets
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---


---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
