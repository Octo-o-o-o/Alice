# Alice 多 AI Provider 支持完整设计方案

> 版本: 1.1 (更新于 2026-02-15)
> 参考项目: [CodexBar](https://github.com/steipete/CodexBar)

**更新日志**:
- `v1.1`: 反映最新架构 - WorkspaceView 替换 TaskView，新增 ReportView
- `v1.0`: 初始版本

## 目录

1. [概述与定位](#1-概述与定位)
2. [Provider 分析](#2-provider-分析)
3. [架构设计](#3-架构设计)
4. [UI/UX 设计](#4-uiux-设计)
5. [数据模型](#5-数据模型)
6. [实现计划](#6-实现计划)
7. [风险与限制](#7-风险与限制)

---

## 1. 概述与定位

### 1.1 项目定位

Alice 是一个 **macOS 菜单栏应用**，专注于：
- 监控 AI CLI 工具的会话和使用情况
- 管理任务队列
- 提供便捷的工作流管理

**不是**：
- 一个通用的 AI CLI 管理器
- 一个复杂的多账户系统
- 一个 AI 模型切换工具

### 1.2 设计原则

1. **Simple First**: 优先支持核心功能，避免过度抽象
2. **渐进式增强**: 单 Provider 用户无感知，多 Provider 自然发现
3. **保持一致性**: 维持 Alice 现有的设计语言和交互模式
4. **实用主义**: 先实现 Codex，Gemini 可选

### 1.3 支持计划

| Provider | 优先级 | 支持程度 | 理由 |
|----------|--------|---------|------|
| **Claude** | P0 | ✅ 完整 | 已支持，核心功能 |
| **Codex** | P1 | 🎯 完整 | JSONL 格式相似，易实现 |
| **Gemini** | P2 | ⚠️ 部分 | 格式未知，先支持使用情况 |

---

## 2. Provider 分析

### 2.1 Claude Code (已支持)

```yaml
CLI: claude
数据目录: ~/.claude/projects/**/*.jsonl
认证: ~/.claude/.credentials.json (OAuth)
OAuth API: https://api.anthropic.com/api/oauth/usage
会话格式: JSONL (type, timestamp, message, usage)
```

### 2.2 OpenAI Codex CLI (计划支持)

```yaml
CLI: codex
数据目录: ~/.codex/sessions/YYYY/MM/DD/*.jsonl
归档: ~/.codex/archived_sessions/*.jsonl
认证: ~/.codex/auth.json
OAuth API: https://chatgpt.com/backend-api/wham/usage
PTY 命令: /status
```

**Codex JSONL 格式** (参考 CodexBar):
```jsonl
{
  "event_msg": {...},
  "token_count": {
    "input": 1234,
    "output": 567,
    "cached": 89
  },
  "turn_context": {
    "model": "gpt-4o"
  }
}
```

### 2.3 Google Gemini CLI (可选支持)

```yaml
CLI: gemini
数据目录: ~/.gemini/
认证: ~/.gemini/oauth_creds.json
配额 API: https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
PTY 命令: /stats
```

**初期建议**: 仅支持使用情况监控 + 任务队列，跳过会话解析

---

## 3. 架构设计

### 3.1 Provider 抽象（简化版）

```rust
// src-tauri/src/providers/mod.rs

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderId {
    Claude,
    Codex,
    // Gemini, // 可选，后期添加
}

pub trait Provider {
    fn id(&self) -> ProviderId;
    fn is_installed(&self) -> bool;
    fn get_session_dirs(&self) -> Vec<PathBuf>;
    fn parse_session(&self, path: &Path) -> Result<Session>;
    fn get_usage(&self) -> Result<ProviderUsage>;
}
```

**设计要点**:
- 不过度抽象，保持简单
- 每个 Provider 独立实现
- 共享通用逻辑（如 OAuth）

### 3.2 文件结构

```
src-tauri/src/
├── providers/
│   ├── mod.rs           # Provider trait 和 ProviderId enum
│   ├── claude.rs        # Claude 实现（重构现有代码）
│   └── codex.rs         # Codex 实现（新增）
├── session.rs           # 通用 Session 结构
├── session_claude.rs    # Claude JSONL 解析
├── session_codex.rs     # Codex JSONL 解析
└── ...
```

### 3.3 当前架构集成

Alice 现有架构 (最新):
```
App.tsx - 5 个主 Tab
├── WorkspaceView (Workspace = Sessions + Tasks)
│   ├── [Sessions]
│   │   ├── Active Tab: 活跃会话 (SessionCard 列表)
│   │   └── History Tab: 会话历史 (复用 HistoryView)
│   │
│   └── [Tasks]
│       ├── Queue Tab: 任务队列
│       └── Backlog Tab: 待办任务
│
├── FavoriteView (收藏的 Prompts)
├── UsageView (使用情况统计)
├── ReportView (每日报告)
└── ConfigView (设置)
```

**Sub-tabs 布局** (WorkspaceView):
```
[Sessions]              [Tasks]
Active | History  |  Queue | Backlog
                  ↑
              视觉分隔线
```

**集成策略**:
- Session 添加 `provider: ProviderId` 字段
- Task 添加 `provider: ProviderId` 字段
- 最小化 UI 改动，优先使用视觉标识
- WorkspaceView 统一管理 Sessions 和 Tasks

---

## 4. UI/UX 设计

### 4.1 设计原则

1. **视觉优先**: 颜色 + 图标 > 文字标签
2. **非侵入式**: 单 Provider 用户体验不变
3. **一致性**: 保持 Alice 玻璃态设计语言
4. **简洁性**: 避免复杂的筛选器和分组

### 4.2 Provider 视觉标识

#### 颜色方案

```typescript
export const PROVIDER_COLORS = {
  claude: {
    primary: '#D97706',   // 琥珀色
    light: '#FBBF24',
    glow: 'rgba(217, 119, 6, 0.3)',
  },
  codex: {
    primary: '#10B981',   // 绿色
    light: '#34D399',
    glow: 'rgba(16, 185, 129, 0.3)',
  },
  // gemini: {
  //   primary: '#3B82F6',
  //   light: '#60A5FA',
  //   glow: 'rgba(59, 130, 246, 0.3)',
  // },
};
```

**为何这样选色?**
- Claude: 琥珀色 - Anthropic 品牌色调
- Codex: 绿色 - OpenAI 绿色主题
- 三色在色环上分布均匀，易区分

#### 图标方案

```typescript
import { Zap, Code2, Sparkles } from 'lucide-react';

export const PROVIDER_ICONS = {
  claude: Zap,      // ⚡ 闪电
  codex: Code2,     // 💻 代码
  // gemini: Sparkles, // ✨ 星光
};
```

### 4.3 各视图适配

#### WorkspaceView - Active Tab (Sessions)

**SessionCard 改造**:
```tsx
<div
  className="glass-card border-l-[3px]"
  style={{
    borderLeftColor: PROVIDER_COLORS[session.provider].primary
  }}
>
  {/* 右上角 Provider 徽章 */}
  <div className="absolute top-3 right-3">
    <ProviderBadge provider={session.provider} size="xs" />
  </div>

  {/* 原有内容 */}
</div>
```

**效果**:
```
┌│──────────────────────────────┐
││ ⚡  Fix login bug         [⚡]│ ← 琥珀色左边框 + Claude 徽章
││     /project/app             │
││     2 min ago • 1.2K tokens  │
└│──────────────────────────────┘
```

**项目筛选器** (如已有 1+ 项目):
```tsx
// 保持现有的项目下拉筛选器
// 无需为 Provider 添加额外筛选器
```

#### WorkspaceView - History Tab (Sessions)

**时间轴视图 + Provider 彩色线**:
```tsx
// 复用独立的 HistoryView 组件
// 添加 Provider 彩色指示线
{sessions.map(session => (
  <div className="flex gap-3">
    <div
      className="w-1 rounded-full"
      style={{ backgroundColor: PROVIDER_COLORS[session.provider].primary }}
    />
    <SessionCard session={session} />
  </div>
))}
```

#### WorkspaceView - Queue & Backlog Tabs (Tasks)

**任务卡片**:
```tsx
<div className="task-card">
  {/* 左侧 Provider 彩色点 */}
  <div
    className="w-2 h-2 rounded-full"
    style={{ backgroundColor: PROVIDER_COLORS[task.provider].primary }}
  />

  {/* 任务内容 */}
  <span>{task.prompt}</span>
</div>
```

#### FavoriteView

**保持不变**: 收藏夹不需要 Provider 区分（prompts 是通用的）

#### UsageView

**方案 A: 简单统计卡片** (推荐 MVP)

```tsx
<div className="space-y-4">
  {/* Claude 使用情况 */}
  <ProviderUsageCard provider="claude" />

  {/* Codex 使用情况（如已启用）*/}
  {codexEnabled && <ProviderUsageCard provider="codex" />}

  {/* 统一的总开销图表 */}
  <CombinedUsageChart />
</div>
```

**方案 B: 横向对比卡片** (后期优化)

```tsx
<div className="grid grid-cols-2 gap-4">
  <ProviderUsageCard provider="claude" />
  <ProviderUsageCard provider="codex" />
</div>
```

#### HistoryView

**时间轴 + Provider 彩色指示线**:

```tsx
{sessions.map(session => (
  <div className="flex gap-3">
    {/* Provider 彩色指示线 */}
    <div
      className="w-1 rounded-full"
      style={{
        backgroundColor: PROVIDER_COLORS[session.provider].primary
      }}
    />

    {/* Session 卡片 */}
    <SessionCard session={session} />
  </div>
))}
```

#### ConfigView

**Provider 设置面板**:

```tsx
<div className="space-y-4">
  <h3>AI Providers</h3>

  <ProviderConfigCard provider="claude" />
  <ProviderConfigCard provider="codex" />

  {/* 每个卡片显示: */}
  {/* - Provider 图标 + 名称 */}
  {/* - 安装状态 ✓ Installed / ! Not installed */}
  {/* - 启用/禁用开关 */}
  {/* - 数据目录: ~/.codex */}
</div>
```

#### ReportView (每日报告)

**Provider 区分** (可选):
```tsx
// 报告中可以显示各 Provider 的统计信息
<div className="report-section">
  <h3>Sessions by Provider</h3>
  <div className="provider-stats">
    <div className="stat-item">
      <ProviderBadge provider="claude" showLabel />
      <span>{claudeSessionCount} sessions</span>
    </div>
    <div className="stat-item">
      <ProviderBadge provider="codex" showLabel />
      <span>{codexSessionCount} sessions</span>
    </div>
  </div>
</div>
```

**建议**: 初期不区分 Provider，保持简单

### 4.4 Sub-tabs 布局说明

**WorkspaceView 内部结构**:
```tsx
<div className="sub-tabs">
  {/* Sessions 组 */}
  <button onClick={() => setTab('active')}>Active</button>
  <button onClick={() => setTab('history')}>History</button>

  {/* 分隔线 */}
  <div className="divider" />

  {/* Tasks 组 */}
  <button onClick={() => setTab('queue')}>Queue</button>
  <button onClick={() => setTab('backlog')}>Backlog</button>
</div>
```

**视觉布局**:
```
[Sessions]              [Tasks]
Active | History  |  Queue | Backlog
                  ↑
              视觉分隔线
```

**布局优势**:
- **概念清晰**: Sessions (左) vs Tasks (右)
- **视觉分组**: 分隔线明确区分两类功能
- **逻辑一致**: Active/History 都是会话监控，Queue/Backlog 都是任务管理
- **Provider 融合**: 各 sub-tab 内容都支持多 Provider 显示

### 4.5 不需要的功能

❌ **全局 Provider 筛选器** - 过于复杂，单 Provider 用户困惑
❌ **Provider 分组视图** - 增加认知负担
❌ **快捷键切换 Provider** - 使用场景少
❌ **侧边栏 Provider 切换** - 空间有限

✅ **仅需要**: 颜色编码 + 小徽章 + 配置开关

---

## 5. 数据模型

### 5.1 数据库 Schema 变更

```sql
-- 会话表添加 provider 字段
ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
CREATE INDEX idx_sessions_provider ON sessions(provider);

-- 任务表添加 provider 字段
ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
CREATE INDEX idx_tasks_provider ON tasks(provider);

-- Provider 配置表（简化）
CREATE TABLE IF NOT EXISTS provider_configs (
    id TEXT PRIMARY KEY,           -- 'claude', 'codex'
    enabled INTEGER NOT NULL DEFAULT 1,
    data_dir TEXT,                 -- 自定义数据目录（可选）
    updated_at INTEGER NOT NULL
);
```

### 5.2 TypeScript 类型

```typescript
// src/lib/types.ts

export type ProviderId = "claude" | "codex"; // | "gemini";

export interface Session {
  provider: ProviderId;  // 新增
  session_id: string;
  project_path: string;
  // ... 其他字段
}

export interface Task {
  provider: ProviderId;  // 新增
  id: string;
  prompt: string;
  // ... 其他字段
}

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  display_name: string;
  data_dir: string;
  icon: string;
  color: string;
}

export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  account_email: string | null;
}

export interface ProviderUsage {
  id: ProviderId;
  session_percent: number;
  session_reset_at: string | null;
  weekly_percent: number | null;
  weekly_reset_at: string | null;
  last_updated: number;
  error: string | null;
}
```

### 5.3 配置文件

```json
// ~/.alice/config.json
{
  "providers": {
    "claude": {
      "enabled": true,
      "data_dir": null  // null = 使用默认 ~/.claude
    },
    "codex": {
      "enabled": false,  // 默认禁用，用户手动开启
      "data_dir": null
    }
  },
  // ... 其他配置
}
```

---

## 6. 实现计划

### Phase 1: Provider 抽象层 (2 天)

**目标**: 重构现有 Claude 代码，建立 Provider 框架

- [ ] 创建 `providers/mod.rs` - Provider trait 定义
- [ ] 重构 `session.rs` 添加 `provider` 字段
- [ ] 创建 `providers/claude.rs` - 将现有代码迁移
- [ ] 更新数据库 schema
- [ ] 更新 TypeScript 类型
- [ ] 测试 Claude 功能无回归

**产出**:
- Provider 抽象层完成
- Claude 作为第一个 Provider 实现
- 数据库迁移脚本

### Phase 2: Codex 支持 (3 天)

**目标**: 实现 Codex Provider

- [ ] 创建 `providers/codex.rs`
- [ ] 实现 `session_codex.rs` - Codex JSONL 解析
- [ ] 添加 Codex 会话目录监控 (`~/.codex/sessions/`)
- [ ] 实现 Codex OAuth 使用情况获取
- [ ] Codex 任务队列执行支持
- [ ] 测试 Codex 和 Claude 并存

**产出**:
- Codex 完整支持
- 会话监控 + 使用情况 + 任务队列
- 单元测试

### Phase 3: UI 视觉标识 (2 天)

**目标**: 添加 Provider 视觉区分

- [ ] 创建 `lib/provider-colors.ts` - 颜色和图标定义
- [ ] 创建 `ProviderBadge.tsx` 组件
- [ ] SessionCard 添加左侧彩色条
- [ ] TaskCard 添加 Provider 彩色点
- [ ] HistoryView 添加彩色指示线
- [ ] 测试视觉效果

**产出**:
- Provider 视觉标识系统
- 所有视图支持 Provider 显示

### Phase 4: 配置管理 (1 天)

**目标**: Provider 启用/禁用管理

- [ ] ConfigView 添加 Provider 设置面板
- [ ] `ProviderConfigCard` 组件
- [ ] Provider 启用/禁用切换
- [ ] CLI 安装状态检测
- [ ] 数据目录配置（可选）

**产出**:
- Provider 配置 UI
- 安装状态检测

### Phase 5: UsageView 增强 (1-2 天，可选)

**目标**: 多 Provider 使用情况对比

- [ ] `ProviderUsageCard` 组件
- [ ] 横向对比布局（2 列）
- [ ] 响应式适配
- [ ] 统一成本图表

**产出**:
- 多 Provider 使用情况视图

### Phase 6: Gemini 支持 (3 天，可选)

**目标**: 部分支持 Gemini

- [ ] 调研 Gemini CLI 会话文件格式
- [ ] 实现 `providers/gemini.rs`（仅使用情况）
- [ ] Gemini OAuth token 刷新
- [ ] 配额 API 调用
- [ ] 任务队列执行

**产出**:
- Gemini 使用情况监控
- Gemini 任务队列（跳过会话解析）

---

## 7. 风险与限制

### 7.1 技术风险

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| Codex JSONL 格式与文档不符 | 高 | 参考 CodexBar 实际实现 |
| Gemini CLI 无会话文件 | 中 | 仅支持使用情况，跳过会话解析 |
| OAuth token 刷新逻辑复杂 | 中 | 参考 CodexBar，先支持基础功能 |
| 多 Provider 并发监控性能 | 低 | 使用独立 watcher，异步处理 |

### 7.2 用户体验限制

**不支持的功能**:
- ❌ 跨 Provider 任务依赖 (如 Claude 任务依赖 Codex 结果)
- ❌ Provider 之间的数据迁移
- ❌ 统一的对话历史（各 Provider 会话独立）
- ❌ 动态切换 Provider 执行任务

**原因**: 保持简单，避免过度设计

### 7.3 性能考虑

**潜在问题**:
- 多个 Provider 同时监控文件系统
- 多个 OAuth API 并发请求

**优化策略**:
- 每个 Provider 独立 watcher，避免相互阻塞
- 使用情况刷新频率降低（5 分钟 → 10 分钟）
- 懒加载：仅监控已启用的 Provider

### 7.4 兼容性考虑

**已有功能保持不变**:
- ✅ 现有 Claude 用户体验无影响
- ✅ 单 Provider 用户看不到多余 UI
- ✅ 数据库向后兼容（`provider` 默认为 `'claude'`）

**迁移策略**:
```sql
-- 现有数据自动标记为 Claude
UPDATE sessions SET provider = 'claude' WHERE provider IS NULL;
UPDATE tasks SET provider = 'claude' WHERE provider IS NULL;
```

---

## 附录

### A. CodexBar 参考资源

- [CodexBar GitHub](https://github.com/steipete/CodexBar)
- [Codex Provider 文档](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
- [Gemini Provider 文档](https://github.com/steipete/CodexBar/blob/main/docs/gemini.md)
- [Provider 开发指南](https://github.com/steipete/CodexBar/blob/main/docs/provider.md)

### B. 实现检查清单

**Phase 1 完成标准**:
- [ ] Provider trait 定义清晰
- [ ] Claude 代码迁移完成
- [ ] 数据库迁移无报错
- [ ] 现有功能无回归

**Phase 2 完成标准**:
- [ ] Codex 会话正确解析
- [ ] Codex 使用情况准确显示
- [ ] Codex 任务队列正常运行
- [ ] Claude + Codex 并存无冲突

**Phase 3 完成标准**:
- [ ] SessionCard 彩色条显示正确
- [ ] Provider 徽章清晰可见
- [ ] 颜色对比度符合 WCAG AA
- [ ] 深色主题下可读性良好

**Phase 4 完成标准**:
- [ ] Provider 可通过 UI 启用/禁用
- [ ] 安装状态准确检测
- [ ] 配置持久化正确

### C. 与 ClaudeEnvironment 的关系

**当前**: Alice 已支持 `claude_environments` (多环境配置)

```typescript
export interface ClaudeEnvironment {
  id: string;
  name: string;
  config_dir: string;
  api_key?: string | null;
  model?: string | null;
  command?: string | null;
  enabled: boolean;
}
```

**Provider vs Environment**:
- **Provider**: 不同的 AI CLI 工具 (Claude, Codex, Gemini)
- **Environment**: 同一 Provider 的不同配置 (如 Claude 的多个账户)

**两者关系**:
```
Provider (Claude)
  └── Environment 1: Personal (config_dir: ~/.claude)
  └── Environment 2: Work (config_dir: ~/.claude-work)

Provider (Codex)
  └── Environment 1: Default (config_dir: ~/.codex)
```

**实现建议**:
- 先实现 Provider 层（跨 CLI 工具）
- Environment 功能保持独立（每个 Provider 内部的多配置）
- 未来可考虑：`Session.environment_id` 关联

---

## 总结

这个方案：
1. **保持简单** - 避免过度抽象，优先实现核心功能
2. **渐进式** - Codex 优先，Gemini 可选
3. **非侵入式** - 单 Provider 用户体验不变
4. **视觉优先** - 颜色 + 图标 > 复杂筛选器
5. **实用主义** - 参考 CodexBar，但不照搬

**下一步**: 开始 Phase 1 - Provider 抽象层重构
