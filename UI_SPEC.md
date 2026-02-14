# Alice - UI/UX Design Specification

> **Version**: 1.2 (Revised)
> **Platforms**: macOS (primary), Windows (supported with fallbacks)
> **Framework**: React + TypeScript + Tailwind CSS (Tauri 2.0 shell)
> **Theme**: Premium Dark Glassmorphism + Coordinated Light Mode
> **Font Family**: Inter (UI), JetBrains Mono (Code) - **Bundled locally** for offline reliability.

---

## 1. Design Philosophy

Alice uses a **"Visual Control Plane"** aesthetic—dense, data-rich, yet highly readable through hierarchy and translucency. It feels like a native extension of macOS but with a futuristic, developer-focused edge.

-   **Glassmorphism**: Heavy use of `backdrop-blur` and translucent backgrounds to maintain context.
-   **Status-Driven**: Color is used primarily to indicate state (Running, Done, Error, Waiting).
-   **Micro-Interactions**: Subtle pulses and glows guide attention to active tasks without distraction.
-   **Information Density**: High. Designed for power users.
-   **Dimensions**:
    -   Default Width: `480px` (Increased from 420px to accommodate usage dashboards).
    -   Max Height: Controlled via Tauri window config, not CSS `vh`.

## 1.1 Light Mode Adaptation
While Dark Mode is primary, Light Mode must feel equally premium, avoiding "washed out" or "muddy" contrast.
-   **Philosophy**: "Ceramic & Glass". Instead of glowing lights in darkness, think of high-quality white ceramic with translucent frosted glass overlays.
-   **Contrast**: Text must be significantly darker than simple inversion (Gray-500 in dark != Gray-500 in light).
-   **Shadows**: Softer, more diffuse shadows (`shadow-lg`, `shadow-xl`) replace the "glow" effects of dark mode.

---

## 2. Design Tokens (Tailwind Config)

These tokens must be added to `tailwind.config.js` to ensure consistency.

### 2.1 Color Palette

| Token | Value | Usage |
| :--- | :--- | :--- |
| `gray-750` | `#2d3342` | Card borders / hover states |
| `gray-850` | `#1a202c` | Main panel background (behind glass) |
| `gray-900` | `#111827` | Footers / Headers |
| `gray-950` | `#0B0F19` | Deepest background / Modal overlays |
| `alice-bg` | `rgba(20, 20, 30, 0.75)` | Main window backdrop |
| `alice-border` | `rgba(255, 255, 255, 0.08)` | 1px border for all glass panels |

### 2.1.1 Light Mode Palette (Overrides)
| Token | Dark Value | Light Value | Usage |
| :--- | :--- | :--- | :--- |
| `bg-primary` | `rgb(20, 20, 30)` | `#FFFFFF` | Main window background |
| `bg-secondary`| `rgb(11, 15, 25)` | `#F3F4F6` | Sidebar / deeply nested |
| `text-primary`| `#e5e7eb` (Gray-200) | `#111827` (Gray-900) | Main text |
| `text-muted`  | `#9ca3af` (Gray-400) | `#6b7280` (Gray-500) | Secondary text |
| `border-glass`| `white/5` | `black/5` | Dividers |
| `shadow-glow` | `rgba(color, 0.3)` | `rgba(color, 0.15)` | Status indicators |

### 2.2 Functional Colors (Status)

| State | Color Code | Tailwind Class | Meaning |
| :--- | :--- | :--- | :--- |
| **Active** | Blue-500 (`#3b82f6`) | `text-blue-400`, `bg-blue-500` | Running session, processing |
| **Success** | Emerald-500 (`#10b981`) | `text-green-400`, `bg-green-500` | Task completed successfully |
| **Warning** | Amber-500 (`#f59e0b`) | `text-yellow-400`, `bg-yellow-500` | Needs user input, user confirmation |
| **Error** | Red-500 (`#ef4444`) | `text-red-400`, `bg-red-500` | Tool failure, API error, crash |
| **Idle** | Gray-500 (`#6b7280`) | `text-gray-500`, `bg-gray-700` | Pending queue, backlog items |

### 2.3 Effects (Shadows & Blurs)

```javascript
// tailwind.config.js extension
boxShadow: {
  'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
  'glow-blue': '0 0 15px rgba(59, 130, 246, 0.3)', // Active
  'glow-red': '0 0 15px rgba(239, 68, 68, 0.3)',   // Error
  'glow-yellow': '0 0 15px rgba(245, 158, 11, 0.3)', // Input Needed
},
backdropBlur: {
  'xs': '2px', // Slight overlays
  'glass': '16px', // Main panels
},
animation: {
  'float': 'float 6s ease-in-out infinite',
  'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  'shimmer': 'shimmer-slide 1.5s infinite',
},
keyframes: {
  float: {
    '0%, 100%': { transform: 'translateY(0)' },
    '50%': { transform: 'translateY(-5px)' },
  },
  'shimmer-slide': {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(100%)' },
  }
}
```

---

## 3. Typography

### 3.1 Font Stack

-   **Primary (UI)**: `Inter`, sans-serif
    -   Weights: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold)
-   **Monospace (Code/Paths)**: `JetBrains Mono`, monospace
    -   Usage: File paths, error codes, tokens, timestamps.

**Note**: Fonts must be bundled as assets (woff2) in `src/assets/fonts/` and loaded via `@font-face` in `index.css`. Do not rely on Google Fonts CDN.

### 3.2 Type Scale

| Component | Size | Weight | Tracking | Color |
| :--- | :--- | :--- | :--- | :--- |
| **Section Header** | 12px | 600 (SemiBold) | `tracking-wider` (uppercase) | `text-gray-400` |
| **Card Title** | 14px | 500 (Medium) | Normal | `text-gray-100` |
| **Body Text** | 12px | 400 (Regular) | Normal | `text-gray-400` |
| **Metadata/Badge** | 10px | 500 (Medium) | Normal | `text-gray-500` / Colored |
| **Mono Snippet** | 11px | 400 (Regular) | Normal | `text-gray-300` |
| **Nav Label** | 9px | 500 (Medium) | Normal | `text-gray-500` / Active |

---

## 4. Component Library (Atoms)

### 4.1 Buttons

| Variant | Classes | Usage |
| :--- | :--- | :--- |
| **Primary** | `bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1.5 text-xs font-medium transition-colors shadow-lg shadow-blue-900/20` | Main actions (Start, Reply, Save) |
| **Secondary** | `bg-white/[0.1] hover:bg-white/[0.15] text-white rounded px-3 py-1.5 text-xs border border-white/[0.05]` | Cancel, Dismiss, Secondary options |
| **Ghost** | `text-gray-400 hover:text-white hover:bg-white/[0.05] rounded px-2 py-1 transition-colors` | Icon buttons, inline actions |
| **Destructive** | `bg-red-500/[0.1] hover:bg-red-500/[0.2] text-red-300 border border-red-500/[0.2]` | Delete, Abort |

### 4.2 Badges & Chips

| Variant | Classes | Usage |
| :--- | :--- | :--- |
| **Status (Blue)** | `bg-blue-500/10 text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded text-[10px]` | Running, Active |
| **Project** | `bg-gray-800 text-gray-300 border border-gray-700 px-1.5 py-0.5 rounded text-[10px]` | Project names |
| **Tag** | `text-gray-400 bg-gray-900/50 px-1 rounded text-[10px] font-mono` | Metadata, counts |

### 4.3 Toasts (Snackbar)

Floating notification at bottom-center of the panel.

```jsx
<div className="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-gray-900/90 backdrop-blur-md border border-white/10 rounded-full shadow-xl z-50 animate-toast-in">
{/* Requires custom animation in tailwind config:
     'toast-in': 'toast-in 0.3s ease-out',
     keyframes: { 'toast-in': { '0%': { opacity: 0, transform: 'translate(-50%, 8px)' }, '100%': { opacity: 1, transform: 'translate(-50%, 0)' } } }
*/}
  <Icon className="w-4 h-4 text-green-400" />
  <span className="text-xs text-white">Session resumed successfully</span>
</div>
```

### 4.4 Search Input (Omnibox)

Spotlight-style search, used in History and as global `⌘K` trigger.

```jsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
  <input
    className="w-full bg-white/[0.05] border border-white/[0.1] rounded-lg py-2 pl-9 pr-12
               text-sm text-gray-200 placeholder:text-gray-500
               focus:ring-1 focus:ring-blue-500/50 focus:bg-white/[0.08] focus:outline-none
               transition-colors"
    placeholder="Search sessions..."
  />
  <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-600
                  bg-gray-800 border border-gray-700 rounded px-1 py-0.5 font-mono">
    ⌘K
  </kbd>
</div>
```

### 4.5 Status Indicator States

Applied to Active Session Card's left border and status dot. Each state maps to a consistent color set.

| State | Left Border | Dot Color | Dot Animation | Background Tint | Action Row |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Running** | `border-l-blue-500` | `bg-blue-500 shadow-glow-blue` | `animate-pulse` | None | — |
| **Needs Input** | `border-l-yellow-500` | `bg-yellow-500 shadow-glow-yellow` | `animate-pulse-slow` | `bg-yellow-500/[0.02]` | "Reply" / "Open Terminal" buttons |
| **Error** | `border-l-red-500` | `bg-red-500 shadow-glow-red` | None | `bg-red-500/[0.05]` | Error message in mono, "Retry" button |
| **Completed** | `border-l-green-500` | `bg-green-500` | None (static) | None | "Resume" / "Copy ID" on hover |
| **Queued** | `border-l-gray-500` | `bg-gray-500` | None | `opacity-60` | "Remove" / "Move Up" on hover |

### 4.6 Task Queue Item

Visualizes chained tasks with dependency lines.

```jsx
<div className="relative pl-6">
  {/* Connector line */}
  {!isLast && (
    <div className="absolute left-[11px] top-6 bottom-0 w-px bg-white/10" />
  )}

  {/* Status circle */}
  <div className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2
    ${status === 'completed' ? 'bg-green-500 border-green-500' :
      status === 'running' ? 'bg-blue-500 border-blue-500 animate-pulse' :
      status === 'error' ? 'bg-red-500 border-red-500' :
      'bg-transparent border-gray-600'}`}
  />

  {/* Content */}
  <div className="bg-white/[0.03] border border-white/[0.05] rounded-lg p-2.5 mb-2
                  hover:bg-white/[0.06] transition-colors group">
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-200 truncate">{taskPrompt}</span>
      <GripVertical className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100
                               cursor-grab" />
    </div>
    <div className="flex items-center gap-2 mt-1">
      <Badge text={projectName} />
      <span className="text-[10px] text-gray-500">{status}</span>
    </div>
  </div>
</div>
```

### 4.7 Icon Library

Use **Lucide React** (`lucide-react`) for all UI icons.

| Icon | Usage | View |
| :--- | :--- | :--- |
| `Activity` | Active sessions indicator | Active |
| `ListTodo` | Unified tasks (backlog + queue) | Tasks |
| `Zap` | Token/Cost stats | Usage |
| `Clock` | Duration / History | History |
| `Settings` | Configuration | Config |
| `Search` | Search bar | Global |
| `AlertCircle` | Error state | Cards |
| `CheckCircle2` | Success state | Cards |
| `Pause` / `Play` | Queue controls | Queue |
| `ChevronRight` | Disclosure / expand | Lists |
| `GripVertical` | Drag handle | Queue |
| `Copy` | Copy to clipboard | Actions |
| `ExternalLink` | Open in terminal | Actions |
| `Bell` | Notifications | Header |
| `FolderOpen` | Project selector | Cross-project |

---

## 5. Main Views Specification

### 5.1 Navigation Bar (Footer)

Sticky footer for switching primary views.

```jsx
<nav className="h-10 border-t border-white/5 bg-gray-950/80 backdrop-blur-xl flex items-center justify-around px-2">
  <ViewTab icon={Activity} label="Active" isActive />
  <ViewTab icon={ListTodo} label="Tasks" badge={taskCount} />
  <ViewTab icon={Zap} label="Usage" />
  <ViewTab icon={Clock} label="History" />
  <ViewTab icon={Settings} label="Config" />
</nav>

// ViewTab Component
<button className={`flex flex-col items-center justify-center w-full h-full space-y-0.5 ${isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
  <Icon size={16} />
  <span className="text-[9px] font-medium">{label}</span>
</button>
```

### 5.2 Active Session Card (Corrected)

Handles dynamic resizing and status states.

```jsx
<div className="
  group relative
  bg-white/[0.03] hover:bg-white/[0.06]
  border-t border-r border-b border-white/[0.05] hover:border-white/[0.1]
  rounded-lg p-3 transition-all
  border-l-2 border-l-blue-500 /* Dynamic status color */
">
  {/* Header */}
  <div className="flex justify-between items-start mb-2">
    <div className="flex items-center gap-2 overflow-hidden">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-glow-blue animate-pulse" />
      <span className="font-medium text-blue-100 text-sm truncate">{projectName}</span>
    </div>
    <span className="text-[10px] font-mono text-gray-500 shrink-0">{duration}</span>
  </div>

  {/* Content Preview */}
  <p className="text-xs text-gray-400 line-clamp-2 mb-2 leading-relaxed font-sans">
    {lastPromptOrAssistantMessage}
  </p>

  {/* Progress Bar (Optional) */}
  <div className="w-full bg-gray-800 rounded-full h-1 mt-2 overflow-hidden">
     <div className="bg-blue-500 h-1 w-full animate-shimmer" />
  </div>

  {/* Footer Metadata */}
  <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.05]">
    <Badge text={modelName} />
    <span className="text-[10px] text-gray-500 font-mono">
      {tokenCount} <span className="opacity-50">(${cost})</span>
    </span>
  </div>
</div>
```

### 5.3 Usage Dashboard

Two-section layout: real-time rate limits (top) + cost analytics (bottom).

#### Rate Limit Meters (via OAuth API)

```jsx
{/* Session (5h) meter */}
<div className="space-y-1">
  <div className="flex justify-between text-[10px]">
    <span className="text-gray-400 font-medium">Session (5h window)</span>
    <span className="text-gray-300 font-mono">{percent}% used</span>
  </div>
  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
    <div className={`h-2 rounded-full transition-all duration-500
      ${percent > 80 ? 'bg-red-500' : percent > 60 ? 'bg-yellow-500' : 'bg-blue-500'}`}
      style={{ width: `${percent}%` }}
    />
  </div>
  <span className="text-[10px] text-gray-500">Resets in {timeRemaining}</span>
</div>

{/* Weekly meter - same structure */}

{/* Burn rate prediction */}
<div className="flex items-center gap-1.5 px-2 py-1.5 bg-yellow-500/[0.06] border border-yellow-500/10 rounded text-[10px]">
  <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
  <span className="text-yellow-300">
    Burn rate ~{rate}%/hr · Session limit in ~{eta}
  </span>
</div>
```

Color thresholds: `0-60%` blue, `60-80%` yellow, `80%+` red.

#### Cost Analytics

-   **Period Selector**: "Today" / "This Week" / "This Month" toggle group.
-   **Summary Row**: Total tokens, total cost, average cost/session — in a 3-column grid.
-   **Daily Bar Chart**: CSS-based bars (no heavy charting lib needed for v1). Each bar is a `<div>` with dynamic height. Hover shows tooltip with date + cost.
-   **Project Breakdown Table**:
    -   Columns: Project Name, Sessions, Tokens (in/out), Cost.
    -   Sortable headers (click to toggle asc/desc).
    -   Row click → filter to that project.
-   **Account Info** (bottom):
    -   `user@email.com` with plan badge (e.g., "Max", "Pro").
    -   "Switch Account" dropdown (Phase 3 feature, show as disabled placeholder initially).

#### Empty State

```
No usage data yet. Start a Claude Code session to see stats here.
```

### 5.4 Unified Tasks View

Two-section layout: Backlog (top) + Queue (bottom). Single view replaces separate Todo and Queue screens.

#### Backlog Section

-   **Header**: "BACKLOG" label + count badge + "Queue Selected" button (Ghost).
-   **Input**: "Add a task..." input (Cmd+N).
-   **List**: Virtualized (`react-virtuoso`), drag-to-reorder.
-   **Item**: Checkbox + text + priority dot (Red/Yellow/Blue) + project badge. Swipe-right or button to move to Queue.
-   **Multi-select**: Long-press or Shift+click to select multiple → batch "Queue" action.

#### Queue Section

-   **Header**: "QUEUE" label + status ("Running" / "Paused" / "Idle") + "Pause All" / "Clear Completed" controls.
-   **Active Task** (top, highlighted): Current running task shown as expanded card with progress shimmer.
-   **Pending Queue**: Vertical list of `TaskQueueItem` components (section 4.6) with connector lines, drag-to-reorder.
-   **Completed Tasks**: Collapsed section, "Show N completed" toggle.

#### Status Flow Visualization

```
Backlog items:  ◻ gray dot, normal opacity
                ↓ (user moves via drag or "Queue" button)
Queued items:   ○ hollow circle with gray border
Running item:   ● blue pulsing dot
Completed:      ✓ green checkmark
Failed:         ✗ red cross
```

-   **Empty State**: "No tasks yet. Add a task to get started."

### 5.5 History / Search Results

-   **Search Bar (Omnibox)**: Sticky at top.
-   **Results List**:
    -   Grouped by Date (Today, Yesterday, Last Week).
    -   Items show: Prompt snippet, Project badge, Time ago, Token count.
    -   Click -> Opens Session Detail / Resume Modal.

### 5.6 Daily Report View

Auto-generated structured report (no AI call in v1). Rendered Markdown view.

-   **Container**: `prose prose-invert prose-sm max-w-none`
-   **Style Overrides**:
    -   `h2`: `text-blue-400 font-semibold border-b border-gray-800 pb-1 mb-2 mt-4`
    -   `ul`: `list-disc pl-4 space-y-1`
    -   `code`: `bg-gray-800 rounded px-1 text-xs`
    -   Table: `text-xs` with `border-gray-800` borders.
-   **Sections**: Sessions list, CC-assisted git commits, usage summary table, pending queued tasks.
-   **Header**: Date selector (← Today →) to browse historical reports.
-   **Actions**: Copy to Clipboard (Floating FAB bottom right), "Save as File" option.
-   **Phase 3**: Optional "AI Summary" toggle adds a 2-3 sentence narrative at top via CC haiku call.

### 5.7 Cross-Project Overview

Shown as the default Active view — a dashboard of all projects with CC activity.

```jsx
{/* Project row */}
<div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
  <FolderOpen className="w-4 h-4 text-gray-500 shrink-0" />
  <div className="flex-1 min-w-0">
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-200 font-medium truncate">{projectName}</span>
      {hasActiveSession && (
        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
    </div>
    <span className="text-[10px] text-gray-500">
      {sessionCount} sessions · {lastActive}
    </span>
  </div>
  <span className="text-[10px] text-gray-500 font-mono shrink-0">${totalCost}</span>
</div>
```

-   Projects sorted by: active sessions first, then by last activity time.
-   Click a project → filters Active view to show only that project's sessions.
-   "All Projects" toggle at top to return to overview.

### 5.8 Settings / Config View

-   **Sections** (vertical scroll):

| Section | Contents |
| :--- | :--- |
| **General** | Launch at login toggle, auto-hide on blur toggle, notification sound toggle |
| **Hooks** | Status indicator (installed ✓ / not installed), "Install Hooks" / "Reinstall" button, shows hook file path |
| **Account** | Current Claude account email, plan badge, "Switch Account" (Phase 3) |
| **Data** | Claude data path (`~/.claude/`), SQLite DB size, "Rescan Now" button, "Export Data" |
| **Shortcuts** | Editable shortcut table (see 5.11) |
| **About** | App version, "Check for Updates", GitHub link |

-   **Toggle Style**: iOS-style switch (`w-9 h-5 rounded-full` with sliding dot).
-   **Section Headers**: Uppercase 10px semibold `text-gray-500 tracking-wider`.

### 5.9 Native Notification Templates

Delivered via Tauri notification plugin. Content templates:

| Event | Title | Body | Action |
| :--- | :--- | :--- | :--- |
| **Task Completed** | `✓ {projectName}` | `"{promptSnippet…}" finished (${cost})` | Click → open Alice, focus session |
| **Task Error** | `✗ {projectName}` | `Error: {errorMessage}` | Click → open Alice, show error |
| **Needs Input** | `⚠ {projectName}` | `Waiting for user input` | Click → open terminal |
| **Queue Task Started** | `▶ Queue: {projectName}` | `Starting: "{promptSnippet…}"` | Click → open Alice |
| **Daily Report Ready** | `📋 Daily Report` | `{date}: {sessionCount} sessions, ${totalCost}` | Click → open report view |

### 5.10 First-Run Onboarding

Shown once on first launch.

-   **Step 1 — Welcome**: Alice logo + "Alice manages your Claude Code sessions across all projects." + "Get Started" button.
-   **Step 2 — Hooks Setup**: Explanation of what hooks do + "Install Hooks" (Primary) / "Skip for now" (Ghost). If skipped, Alice falls back to file watching + process detection (reduced functionality noted).
-   **Step 3 — Scan**: Progress bar scanning `~/.claude/` for existing sessions. "Found N sessions across M projects."
-   **Step 4 — Done**: "You're all set!" + show the Active view.

Style: Full-panel overlay, centered card (`max-w-sm`), step indicator dots at bottom.

### 5.11 Keyboard Shortcuts

| Shortcut | Action | Context |
| :--- | :--- | :--- |
| `⌘K` | Open global search (Omnibox) | Global |
| `⌘N` | Add new task | Tasks view |
| `⌘1`–`⌘5` | Switch to tab 1–5 | Global |
| `⌘R` | Refresh / rescan sessions | Global |
| `⌘,` | Open settings | Global |
| `⌘Q` | Quit Alice | Global |
| `Escape` | Close popup / dismiss modal | Global |
| `↑` / `↓` | Navigate list items | Lists |
| `Enter` | Open / expand selected item | Lists |
| `⌘C` | Copy session resume command | Session selected |
| `Delete` | Remove selected queue item | Queue view |

On Windows, all `⌘` shortcuts map to `Ctrl`.

### 5.12 Menu Bar Icon (Tray)

States correspond to `src-tauri/icons/`:

1.  **Idle**: Monochrome (white/gray) icon.
2.  **Active**: Blue dot/icon.
3.  **Action Needed**: Yellow badge overlaid.
4.  **Error**: Red badge overlaid.
5.  **Complete**: Green checkmark overlaid (transient 5s).

Icon design: 16x16px template image. Use SF Symbols style on macOS, PNG on Windows.

---

## 6. Technical Implementation Details

### 6.1 Window Configuration

-   Set `transparent: true` in `tauri.conf.json`.
-   Set `maxHeight` limit in Tauri window config, not CSS `vh`.
-   Handle window blur events to auto-hide popup (optional user preference).
-   `decorations: false` — custom title bar / no title bar for the popup.
-   `alwaysOnTop: false` — popup should dismiss naturally.

### 6.2 Platform Support

#### macOS (Primary)

| Aspect | Implementation |
| :--- | :--- |
| **Window effect** | `vibrancy: "under-window"` for native glass, fallback to CSS `backdrop-blur` |
| **System tray** | `NSStatusItem`, template image (auto dark/light) |
| **Notifications** | `NSUserNotification` via Tauri notification plugin |
| **File paths** | `~/.claude/` (home directory) |
| **Auto-start** | `LaunchAgent` plist via `tauri-plugin-autostart` |
| **Keychain** | macOS Keychain via `security` CLI or `keyring` crate |
| **Shortcut prefix** | `⌘` (Command) |
| **Min OS** | macOS 12+ (Monterey, for WebKit updates) |

#### Windows (Supported)

| Aspect | Implementation |
| :--- | :--- |
| **Window effect** | `backdrop-filter` unreliable in WebView2. **Fallback**: `bg-[#0B0F19]/95` solid background. Detect via `navigator.userAgentData.platform` or Tauri OS API |
| **System tray** | Windows system tray (`Shell_NotifyIcon`), PNG icon (no template images) |
| **Notifications** | Windows Toast notifications via Tauri plugin |
| **File paths** | `%USERPROFILE%\.claude\` — use Tauri's `homeDir()` API for cross-platform resolution |
| **Auto-start** | Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` via `tauri-plugin-autostart` |
| **Credentials** | Windows Credential Manager via `keyring` crate |
| **Shortcut prefix** | `Ctrl` — all `⌘` shortcuts map to `Ctrl` |
| **Min OS** | Windows 10 1809+ (WebView2 requirement) |
| **Installer** | `.msi` (via Tauri WiX bundler) or `.exe` (NSIS) |

#### Cross-Platform Utility

```typescript
// src/lib/platform.ts
import { platform } from '@tauri-apps/plugin-os';

export const isMac = () => platform() === 'macos';
export const isWin = () => platform() === 'windows';

export const modKey = isMac() ? '⌘' : 'Ctrl';
export const claudeDir = () => isMac()
  ? `${homeDir()}/.claude`
  : `${homeDir()}\\.claude`;

// Glass effect: use CSS class conditionally
export const glassClass = isMac()
  ? 'backdrop-blur-glass bg-alice-bg'
  : 'bg-[#0B0F19]/95';  // solid fallback on Windows
```

### 6.3 Scrollbar Styling

Custom thin scrollbar for all scrollable areas:

```css
/* src/index.css */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
```

### 6.4 List Virtualization

-   Use `react-virtuoso` (preferred over `react-window` — better API for variable-height items).
-   Apply to: `SessionList`, `TaskList`, `HistoryList`.
-   Threshold: virtualize when list exceeds 50 items.

### 6.5 State Management

-   **Zustand**: UI state (active tab, search query, selected project filter, modal state).
-   **TanStack Query**: Data fetching from Rust backend via Tauri `invoke()`. Handles caching, refetching, and stale-while-revalidate for session data.
-   **Tauri Events**: Real-time updates (file watcher events, hook events) pushed from Rust → frontend via `listen()`. These update the Zustand store directly.

### 6.6 Empty States

Every view must have a meaningful empty state:

| View | Empty Message | Secondary Text |
| :--- | :--- | :--- |
| **Active** | No active sessions | Start a Claude Code session in any terminal |
| **Tasks** | No tasks yet | Add a task to get started |
| **Usage** | No usage data yet | Start a Claude Code session to see stats |
| **History** | No sessions found | Your Claude Code history will appear here |
| **Search** | No results for "{query}" | Try different keywords or check spelling |

Style: Centered, `text-gray-500`, with a subtle Lucide icon above (e.g., `Inbox` for empty, `SearchX` for no results).

