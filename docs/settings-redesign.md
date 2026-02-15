# Settings Page Redesign

## Overview
Restructured the settings page from 7 tabs to 3 focused tabs based on developer workflow patterns.

**Target User**: Developers using Claude Code CLI

## Changes Summary

### Before (7 tabs)
1. General
2. AI Providers
3. Claude
4. Integration (Terminal)
5. Notify (Notifications)
6. Data
7. About

### After (3 tabs)
1. **General** - Settings & Integration
2. **Providers** - AI Configuration
3. **About** - Info & Data

---

## Tab Structure Details

### 1. General Tab
**Purpose**: All configuration and integration settings in one place

- **Appearance**: Theme switcher (System/Light/Dark)
- **Behavior**:
  - Launch at login
  - Auto-hide on blur
- **Notifications**: (Unified section)
  - Sound effects toggle
  - Voice announcements toggle
  - Task completed event
  - Task error event
  - Input needed event
- **Shell Integration**:
  - Shell hooks status and installation
  - Terminal app selection
  - Custom terminal command (if applicable)
- **Language**: Reports language selection
- **Shortcuts**: Compact 2-column grid (read-only)

**Rationale**: General is the "command center" - everything a developer needs to configure daily operations, notifications, and system integration.

### 2. Providers Tab
**Purpose**: AI CLI provider configuration and environment management

- **AI Providers**:
  - Claude, Codex, Gemini configuration cards
  - Enable/disable providers
  - Custom data directory settings

- **Claude Environments**:
  - Multiple environment profiles
  - Add/edit/delete/activate environments
  - Visual indicator for active environment

**Rationale**: Developers frequently switch between AI providers and environments when working on different projects. Keeping this focused and independent.

### 3. About Tab
**Purpose**: Application information, account status, and data management

- **App Info**:
  - Alice logo
  - Version number
  - Tagline

- **Claude Account**:
  - Connection status
  - CLI version
  - Account email

- **Data Statistics**:
  - Database size
  - Report count
  - Rescan sessions button
  - Data directory path

- **Actions**:
  - GitHub repository link
  - Reset setup wizard

**Rationale**: About becomes an "information hub" - app metadata, account info, and data statistics all in one place.

---

## UI Improvements

### Header Simplification
- Removed version number from header (now in About tab)
- Cleaner single-line title
- More space for tab navigation

### Shortcuts Compaction
```tsx
// Before: Large vertical list, prominent spacing
<div className="space-y-1">
  <div className="px-2 py-1.5"> /* each shortcut */ </div>
</div>

// After: Compact 2-column grid
<div className="grid grid-cols-2 gap-x-3 gap-y-1">
  <div className="px-1 py-1"> /* each shortcut */ </div>
</div>
```

### Visual Consistency
- All sections use `SectionHeading` component
- Consistent spacing with `space-y-3` pattern
- Glass panel styling maintained throughout

---

## Code Changes

### Files Modified
- `src/views/ConfigView.tsx` - Main refactor

### Removed Imports
- `Bell` - Unused icon
- `HardDrive` - Unused icon
- `Layers` - Unused icon

### Tab Definitions
```tsx
const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "about", label: "About", icon: Info },
];
```

### Tab Navigation
- Removed tab icons from display (icons only in data structure)
- Each tab uses `flex-1` for equal width distribution
- No horizontal scrolling needed

---

## Benefits

### For Developers
1. **Faster Navigation**: 57% fewer tabs (7 → 3)
2. **Logical Grouping**: All settings in General, all AI config in Providers, all info in About
3. **No Weak Tabs**: Every tab has substantial, related content
4. **Clear Purpose**: Configuration → AI → Information

### For Maintenance
1. **Cleaner Code**: Removed redundant tab logic
2. **Better Organization**: Clear section boundaries
3. **Easier to Extend**: Logical places to add new features
4. **Optimal Balance**: Not too simple, not too complex

---

## Migration Notes

| Old Location | New Location |
|-------------|--------------|
| General → Appearance | General → Appearance |
| General → Behavior | General → Behavior |
| General → Shortcuts | General → Shortcuts (bottom, compacted) |
| AI Providers → All | Providers → AI Providers |
| Claude → Account Status | About → Claude Account |
| Claude → Environments | Providers → Claude Environments |
| Integration → Hooks | General → Shell Integration → Hooks |
| Integration → Terminal | General → Shell Integration → Terminal |
| Notify → Sound/Voice | General → Notifications |
| Notify → Events | General → Notifications (merged) |
| Data → Language | General → Language |
| Data → Stats | About → Data Statistics |
| Data → Rescan | About → Data Statistics |
| Data → Directory Path | About → Data Statistics |
| About → App Info | About → App Info |
| About → Actions | About → Actions |

---

## Design Principles Applied

1. **Unified Configuration**: All settings in one place (General)
2. **Focused AI Tab**: Providers tab dedicated to AI configuration only
3. **Information Hub**: About tab for read-only info and data management
4. **No Weak Tabs**: Each tab has substantial, coherent content
5. **Developer-centric**: Configuration → AI → Info workflow

---

## Key Improvements from Previous Version

### From 7 tabs to 3 tabs
- **Removed redundancy**: Merged Notifications + Notification Events
- **Eliminated weak tabs**: System tab was underutilized
- **Better distribution**: General is now comprehensive but not overwhelming
- **Clearer purpose**: Each tab has a distinct, well-defined role

### Navigation Enhancements
- Removed tab icons from display (cleaner look)
- Equal-width tabs (no more horizontal scrolling)
- Only 3 choices to make (optimal for quick navigation)

---

## Future Considerations

- General tab could use collapsible sections if it grows too long
- Providers tab could add a search if many providers are supported
- About tab could show changelog/release notes
- Keyboard shortcuts to jump between tabs (⌘1-3)
