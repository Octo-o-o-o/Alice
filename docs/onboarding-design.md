# Alice 启动向导设计方案

> **版本:** v1.1
> **更新:** 简化步骤、修复技术问题、补充遗漏项

## 概述

Alice 是一个依赖 Claude Code CLI 的桌面应用，需要在首次启动时完成一系列配置才能正常使用所有功能。本文档设计了一个**精简的 4 步**引导流程。

---

## 一、前置依赖清单

### 1.1 核心依赖

| 依赖项 | 必需性 | 用途 | 检测方法 |
|--------|--------|------|----------|
| Claude Code CLI | **必需** | 执行任务、解析会话 | `which claude` (Unix) / `where claude` (Win) |
| ~/.claude/ 目录 | **必需** | 存储会话文件、凭证、配置 | 检查目录是否存在 |
| OAuth 凭证 | 推荐 | 获取使用率统计 | Keychain (Mac) / .credentials.json |
| ~/.alice/ 目录 | 自动创建 | 存储应用数据 | 自动创建 |

### 1.2 可选功能依赖

| 功能 | 依赖项 | 平台 |
|------|--------|------|
| 语音通知 | 系统 TTS (`say` 命令) | 仅 macOS |
| Git 提交报告 | Git CLI | 全平台 |
| 开机自启 | 系统权限 | 全平台 |

---

## 二、平台差异对比

### 2.1 macOS

| 项目 | 实现 |
|------|------|
| 凭证存储 | 系统 Keychain (`security find-generic-password -s "Claude Code-credentials"`) |
| Hook 脚本 | Bash + `date +%s` |
| 托盘位置 | 屏幕顶部，距顶 30px |
| 语音通知 | 支持 (`say -v Samantha`) |
| 最低版本 | macOS 12.0+ |
| 路径格式 | `/Users/username/.claude/` |

### 2.2 Windows

| 项目 | 实现 |
|------|------|
| 凭证存储 | `%USERPROFILE%\.claude\.credentials.json` |
| Hook 脚本 | PowerShell + `[DateTimeOffset]::UtcNow` |
| 托盘位置 | 屏幕底部，距底 60px |
| 语音通知 | **不支持** |
| 路径格式 | `C:\Users\username\.claude\` |
| 特殊处理 | 路径编码处理盘符 |

### 2.3 Linux

| 项目 | 实现 |
|------|------|
| 凭证存储 | `~/.claude/.credentials.json` |
| Hook 脚本 | Bash + `date +%s` |
| 语音通知 | **不支持** |
| 路径格式 | `/home/username/.claude/` |

---

## 三、简化向导流程 (4 步)

```
┌─────────────────────────────────────────────────────────────────┐
│                        启动 Alice 应用                           │
│                              │                                   │
│           ┌──────────────────┴──────────────────┐               │
│           ▼                                      ▼               │
│   onboarding_completed?                  onboarding_completed?   │
│         NO                                      YES              │
│           │                                      │               │
│           ▼                                      ▼               │
│   进入向导流程                              进入主界面            │
└─────────────────────────────────────────────────────────────────┘

向导流程 (4 步):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: 欢迎 & 环境检测 (合并)
┌─────────────────────────────────────────────────────────────────┐
│  🎉 欢迎使用 Alice                                               │
│                                                                  │
│  正在检测您的环境...                                              │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Claude Code CLI    ✓ 已安装 (v1.2.3)                      │  │
│  │ 登录状态           ✓ user@example.com (Max)               │  │
│  │ Claude 目录        ✓ ~/.claude/ 已找到                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [ 高级用户? 跳过全部设置 ]              [继续 →]               │
│                                                                  │
│  ⚠ 如检测失败，显示解决方案并提供 [重新检测] 按钮                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 2: 安装 Hooks (核心步骤)
┌─────────────────────────────────────────────────────────────────┐
│  📡 启用会话追踪                                                 │
│                                                                  │
│  Hooks 让 Alice 实时追踪 Claude Code 会话状态                    │
│                                                                  │
│  将添加到 ~/.claude/settings.json:                               │
│  • SessionStart — 会话开始时通知                                 │
│  • SessionEnd — 会话结束时通知                                   │
│  • Stop — 停止时通知                                             │
│                                                                  │
│  [预览配置 ▼]                                                    │
│                                                                  │
│  [ 跳过 ]                                   [安装 Hooks →]       │
│  ⚠ 跳过后无法实时追踪会话                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 3: 通知 & 偏好设置 (合并)
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️ 个性化设置                                                   │
│                                                                  │
│  通知                                                            │
│  ─────────────────────────────────────────                       │
│  [✓] 任务完成通知                                                │
│  [✓] 通知声音                                                    │
│  [ ] 语音通知 (仅 macOS)                                         │
│                                                                  │
│  启动行为                                                        │
│  ─────────────────────────────────────────                       │
│  [ ] 开机自动启动                                                │
│  [✓] 窗口失焦自动隐藏                                            │
│                                                                  │
│                                             [继续 →]             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 4: 完成 & 首次扫描
┌─────────────────────────────────────────────────────────────────┐
│  ✅ 设置完成！                                                   │
│                                                                  │
│  正在扫描现有会话...                                              │
│  ████████████░░░░░░░░ 60%                                        │
│  已发现 23 个会话                                                 │
│                                                                  │
│  ─────────────────────────────────────────                       │
│  配置摘要:                                                       │
│  • Claude Code ✓        • Hooks ✓                               │
│  • 登录 ✓               • 通知 ✓                                │
│                                                                  │
│                                        [开始使用 Alice →]        │
│                                                                  │
│  提示: 可在设置中随时重新运行此向导                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、详细步骤设计

### Step 1: 欢迎 & 环境检测

**一次性检测所有环境:**
```typescript
interface OnboardingStatus {
  // 环境检测
  cli_installed: boolean;
  cli_version: string | null;
  credentials_found: boolean;
  account_email: string | null;
  subscription_type: 'max' | 'pro' | 'free' | 'team' | 'enterprise' | null;
  claude_dir_exists: boolean;

  // 平台信息
  platform: 'macos' | 'windows' | 'linux';

  // 已有配置 (升级用户)
  hooks_installed: boolean;
  existing_sessions_count: number;
}
```

**检测结果展示:**

| 检测项 | 成功 | 失败 |
|--------|------|------|
| Claude CLI | ✓ v1.2.3 | ✗ 未安装 → 显示安装指引 |
| 登录状态 | ✓ email (plan) | ⚠ 未登录 (功能受限) |
| Claude 目录 | ✓ 已找到 | ✗ 未找到 → CLI 未初始化 |

**阻断条件:**
- Claude CLI 未安装 → **必须安装**
- 其他检测失败 → 可继续，但显示警告

**快速跳过:**
- 提供 "跳过全部设置" 链接（面向高级用户）
- 跳过时使用默认配置

---

### Step 2: 安装 Hooks

**Hook 内容预览 (macOS/Linux):**
```json
{
  "hooks": {
    "SessionStart": [{
      "type": "command",
      "command": "echo '{\"event\":\"session_start\",\"session_id\":\"'$CLAUDE_SESSION_ID'\",\"project\":\"'$CLAUDE_PROJECT_DIR'\",\"timestamp\":'$(date +%s)'}' >> ~/.alice/hooks-events.jsonl"
    }],
    "Stop": [{
      "type": "command",
      "command": "echo '{\"event\":\"stop\",\"session_id\":\"'$CLAUDE_SESSION_ID'\",\"project\":\"'$CLAUDE_PROJECT_DIR'\",\"timestamp\":'$(date +%s)'}' >> ~/.alice/hooks-events.jsonl"
    }],
    "SessionEnd": [{
      "type": "command",
      "command": "echo '{\"event\":\"session_end\",\"session_id\":\"'$CLAUDE_SESSION_ID'\",\"project\":\"'$CLAUDE_PROJECT_DIR'\",\"timestamp\":'$(date +%s)'}' >> ~/.alice/hooks-events.jsonl"
    }]
  }
}
```

**Hook 内容预览 (Windows):**
```json
{
  "hooks": {
    "SessionStart": [{
      "type": "command",
      "command": "powershell -Command \"Add-Content -Path '$env:USERPROFILE\\.alice\\hooks-events.jsonl' -Value ('{\"event\":\"session_start\",\"session_id\":\"' + $env:CLAUDE_SESSION_ID + '\",\"project\":\"' + $env:CLAUDE_PROJECT_DIR + '\",\"timestamp\":' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '}')\""
    }]
  }
}
```

**安装后验证:**
1. 检查 `~/.claude/settings.json` 是否包含 Alice hooks
2. 尝试写入测试事件到 `~/.alice/hooks-events.jsonl`
3. 验证成功后显示 ✓

---

### Step 3: 通知 & 偏好设置

**平台差异化显示:**

| 设置项 | macOS | Windows | Linux |
|--------|-------|---------|-------|
| 任务通知 | ✓ | ✓ | ✓ |
| 通知声音 | ✓ | ✓ | ✓ |
| 语音通知 | ✓ | 隐藏 | 隐藏 |
| 开机启动 | ✓ | ✓ | ✓ |
| 失焦隐藏 | ✓ | ✓ | ✓ |

**默认值:**
- 任务通知: 开启
- 通知声音: 开启
- 语音通知: 关闭
- 开机启动: 关闭
- 失焦隐藏: 开启

---

### Step 4: 完成 & 首次扫描

**首次扫描逻辑:**
```typescript
// 扫描 ~/.claude/projects/ 目录下所有 JSONL 文件
const sessions = await invoke('scan_existing_sessions');
// 返回: { total: number, imported: number }
```

**扫描进度显示:**
- 显示进度条
- 显示已发现的会话数量
- 扫描完成后显示汇总

---

## 五、技术实现

### 5.1 后端新增命令

```rust
// src-tauri/src/commands.rs

/// 获取完整的向导状态
#[tauri::command]
pub async fn get_onboarding_status() -> Result<OnboardingStatus, String> {
    let cli_installed = is_cli_installed();
    let cli_version = get_claude_version();
    let credentials = read_claude_credentials().ok();
    let claude_dir = get_claude_dir();
    let hooks_installed = check_hooks_installed();

    Ok(OnboardingStatus {
        cli_installed,
        cli_version,
        credentials_found: credentials.is_some(),
        account_email: credentials.as_ref().map(|c| c.email.clone()),
        subscription_type: credentials.as_ref().map(|c| c.subscription_type.clone()),
        claude_dir_exists: claude_dir.exists(),
        platform: get_current_platform(),
        hooks_installed,
        existing_sessions_count: count_session_files(),
    })
}

/// 安装 hooks 并验证
#[tauri::command]
pub async fn install_and_verify_hooks() -> Result<HookInstallResult, String> {
    install_hooks()?;

    // 验证安装
    let settings_path = get_claude_settings_path();
    let content = std::fs::read_to_string(&settings_path)?;
    let settings: serde_json::Value = serde_json::from_str(&content)?;

    let has_session_start = settings["hooks"]["SessionStart"].is_array();
    let has_session_end = settings["hooks"]["SessionEnd"].is_array();

    Ok(HookInstallResult {
        success: has_session_start && has_session_end,
        settings_path: settings_path.display().to_string(),
    })
}

/// 扫描现有会话
#[tauri::command]
pub async fn scan_existing_sessions(
    window: tauri::Window
) -> Result<ScanResult, String> {
    let claude_dir = get_claude_projects_dir();
    let files = glob_session_files(&claude_dir);
    let total = files.len();
    let mut imported = 0;

    for (i, file) in files.iter().enumerate() {
        // 导入会话
        if let Ok(_) = import_session_file(file) {
            imported += 1;
        }
        // 发送进度事件
        window.emit("scan_progress", ScanProgress {
            current: i + 1,
            total,
            imported,
        })?;
    }

    Ok(ScanResult { total, imported })
}
```

### 5.2 前端组件结构

```
src/
├── views/
│   └── OnboardingView.tsx       # 向导容器 (管理步骤切换)
├── components/
│   └── onboarding/
│       ├── StepIndicator.tsx    # 步骤指示器 (1-2-3-4)
│       ├── EnvironmentCheck.tsx # Step 1: 环境检测
│       ├── HooksSetup.tsx       # Step 2: Hooks 安装
│       ├── Preferences.tsx      # Step 3: 偏好设置
│       └── Completion.tsx       # Step 4: 完成扫描
```

### 5.3 向导状态管理

```typescript
// src/lib/types.ts

interface OnboardingState {
  currentStep: 1 | 2 | 3 | 4;
  status: OnboardingStatus | null;
  hooksInstalled: boolean;
  preferences: {
    taskNotifications: boolean;
    notificationSound: boolean;
    voiceNotifications: boolean;
    launchAtLogin: boolean;
    hideOnBlur: boolean;
  };
  scanProgress: {
    current: number;
    total: number;
    imported: number;
  } | null;
}
```

---

## 六、向导与主界面切换逻辑

```typescript
// App.tsx

function App() {
  const { data: config } = useQuery(['config'], () => invoke('get_config'));

  // 未完成向导时显示向导界面
  if (!config?.onboarding_completed) {
    return <OnboardingView onComplete={handleOnboardingComplete} />;
  }

  // 完成向导后显示主界面
  return <MainLayout />;
}

function handleOnboardingComplete() {
  // 更新配置
  await invoke('update_config', {
    updates: { onboarding_completed: true }
  });
  // 刷新配置查询，触发界面切换
  queryClient.invalidateQueries(['config']);
}
```

**重新运行向导入口 (设置页面):**
```typescript
// ConfigView.tsx

<button onClick={async () => {
  await invoke('update_config', {
    updates: { onboarding_completed: false }
  });
  window.location.reload();
}}>
  重新运行设置向导
</button>
```

---

## 七、边界情况处理

### 7.1 用户中途关闭应用
- 下次启动继续显示向导（因为 `onboarding_completed` 仍为 false）
- 不需要保存中间状态

### 7.2 已有用户升级
- 检测到 `hooks_installed: true` 时，Step 2 显示 "已安装" 状态
- 检测到已有会话时，Step 4 显示 "发现 N 个现有会话"

### 7.3 Claude CLI 在向导期间被卸载
- 启动时重新检测
- 检测失败时显示提示横幅

### 7.4 权限问题
- 文件写入失败：显示具体路径和错误信息
- 提供手动操作的命令行指引

---

## 八、设计原则

1. **步骤精简** - 4 步完成所有配置
2. **渐进披露** - 高级选项折叠或放到设置页
3. **快速路径** - 高级用户可一键跳过
4. **平台适配** - 根据平台显示相应选项
5. **透明操作** - 展示将要进行的修改

---

## 九、实施清单

### 后端 (Rust)
- [x] `get_onboarding_status` 命令 - 完成
- [x] `install_and_verify_hooks` 命令 - 完成
- [x] `scan_existing_sessions` 命令 (复用 `scan_claude_directory`) - 完成
- [x] `AppConfig` 已有 `onboarding_completed` 字段 - 无需修改

### 前端 (React)
- [x] `OnboardingWizard.tsx` 向导组件 (4 步合一) - 完成
- [x] `App.tsx` 已有向导路由逻辑 - 无需修改
- [x] `ConfigView.tsx` 添加重新运行向导按钮 - 完成

### 类型定义
- [x] `lib/types.ts` 添加 `OnboardingStatus`, `HookVerifyResult`, `ScanResult`, `SystemInfo` 类型 - 完成

---

## 十、附录

### A. 检测命令参考

| 检测项 | macOS/Linux | Windows |
|--------|-------------|---------|
| Claude CLI | `which claude` | `where claude` |
| Claude 版本 | `claude --version` | `claude --version` |
| 凭证文件 | Keychain 或 `~/.claude/.credentials.json` | `%USERPROFILE%\.claude\.credentials.json` |
| Hooks 配置 | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |
| Alice 数据 | `~/.alice/` | `%USERPROFILE%\.alice\` |

### B. 与现有代码的集成点

| 现有功能 | 文件 | 集成方式 |
|----------|------|----------|
| CLI 检测 | `config.rs` | 复用 `is_cli_installed()` |
| 凭证读取 | `usage.rs` | 复用 `read_claude_credentials()` |
| Hooks 安装 | `commands.rs` | 复用 `install_hooks()` |
| 配置管理 | `config.rs` | 复用 `AppConfig` |
| 会话扫描 | `watcher.rs` | 复用扫描逻辑 |
