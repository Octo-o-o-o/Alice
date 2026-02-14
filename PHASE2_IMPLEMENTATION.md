# Alice Phase 2 实施计划

基于全面审查生成的分阶段实施计划。

---

## 阶段概览

| 阶段 | 时间 | 核心目标 | 优先级 |
|------|------|----------|--------|
| **Step 1** | 立即 | 队列执行 + OAuth 集成 | 🔴 CRITICAL |
| **Step 2** | 本周 | 会话恢复按钮 + 搜索 FTS 集成 | 🟡 HIGH |
| **Step 3** | 下周 | 拖拽排序 + 图表可视化 | 🟢 MEDIUM |
| **Step 4** | 持续 | UI 打磨 + 通知操作 | 🔵 ONGOING |

---

## Step 1: 队列执行 + OAuth 集成 (立即)

### 1.1 队列执行引擎完善

**文件**: `src-tauri/src/queue.rs`

**当前状态**: QueueExecutor 结构存在，但缺少实际执行逻辑

**需要实现**:
- [ ] `execute_task()` - 使用 `std::process::Command` 执行 `claude -p`
- [ ] 解析 `--output-format json` 输出
- [ ] 捕获 exit code, tokens, cost
- [ ] 更新任务状态 (running → completed/failed)
- [ ] 错误处理和重试逻辑
- [ ] 发送通知事件到前端

**代码要点**:
```rust
// 执行命令
Command::new("claude")
    .args(&["-p", &task.prompt, "--output-format", "json", "--cwd", &project_path])
    .output()

// 解析结果
struct ClaudeOutput {
    session_id: String,
    result: String,
    cost_usd: f64,
    duration_ms: u64,
}
```

### 1.2 OAuth 实时用量获取

**文件**: `src-tauri/src/usage.rs`

**当前状态**: `fetch_oauth_usage()` 函数存在，但凭证读取不完整

**需要实现**:
- [ ] 从 `~/.claude/.credentials.json` 读取 access_token
- [ ] 调用 `api.anthropic.com/api/oauth/usage` API
- [ ] 解析 five_hour/seven_day 使用百分比
- [ ] 计算重置倒计时
- [ ] 添加 Tauri command 暴露给前端

**API 响应结构**:
```rust
struct UsageResponse {
    five_hour: UsageWindow,      // 5小时会话窗口
    seven_day: UsageWindow,      // 7天周窗口
}

struct UsageWindow {
    percent_used: f64,
    reset_at: String,  // ISO 8601
}
```

### 1.3 前端 UsageMeter 集成

**文件**: `src/components/UsageMeter.tsx`

**需要实现**:
- [ ] 调用 `get_live_usage` 命令
- [ ] 显示两个进度条 (Session + Weekly)
- [ ] 显示重置倒计时
- [ ] 颜色阈值: 0-60% 蓝色, 60-80% 黄色, 80%+ 红色

---

## Step 2: 会话恢复按钮 + 搜索 FTS 集成 (本周)

### 2.1 会话恢复按钮

**文件**: `src/components/SessionCard.tsx`

**需要实现**:
- [ ] 添加 "Resume" 按钮到 SessionCard
- [ ] 点击时调用 `resume_session` 命令
- [ ] 复制 `claude --resume <session_id>` 到剪贴板
- [ ] 显示 Toast 确认
- [ ] 可选: 打开终端窗口

**UI 规格**:
```tsx
<button className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded">
  <Play size={12} /> Resume
</button>
```

### 2.2 搜索 FTS 集成

**文件**: `src/components/SearchOverlay.tsx`, `src-tauri/src/commands.rs`

**需要实现**:
- [ ] 连接 `search_sessions` 命令到 FTS5 查询
- [ ] 实时搜索结果更新 (debounce 300ms)
- [ ] 显示匹配的 session 列表
- [ ] 点击结果→显示详情或跳转

**后端查询**:
```sql
SELECT s.* FROM sessions s
JOIN sessions_fts fts ON s.rowid = fts.rowid
WHERE sessions_fts MATCH ?
ORDER BY rank
LIMIT 20
```

### 2.3 项目过滤器

**文件**: `src/components/SearchOverlay.tsx`

**需要实现**:
- [ ] 添加项目下拉过滤器
- [ ] 加载所有项目列表 (`get_projects` 命令)
- [ ] 按项目筛选搜索结果

---

## Step 3: 拖拽排序 + 图表可视化 (下周)

### 3.1 任务拖拽排序

**文件**: `src/views/TasksView.tsx`

**需要实现**:
- [ ] 安装 `@dnd-kit/core` 和 `@dnd-kit/sortable`
- [ ] 包装任务列表为可拖拽
- [ ] 拖拽结束时更新 `sort_order`
- [ ] 调用后端 `reorder_tasks` 命令

**后端命令**:
```rust
#[tauri::command]
pub fn reorder_tasks(task_ids: Vec<String>) -> Result<(), String> {
    // 更新 sort_order 字段
}
```

### 3.2 CSS 柱状图组件

**文件**: 新建 `src/components/BarChart.tsx`

**需要实现**:
- [ ] 纯 CSS 柱状图 (无外部库)
- [ ] 支持每日使用数据展示
- [ ] Hover 显示详细数值
- [ ] 响应式高度

**组件接口**:
```tsx
interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  maxValue?: number;
  height?: number;
}
```

### 3.3 Usage Dashboard 增强

**文件**: `src/views/UsageView.tsx`

**需要实现**:
- [ ] 集成 BarChart 组件显示每日使用
- [ ] 添加项目分解表格
- [ ] 实现表格排序 (点击列头)
- [ ] 添加周期选择器 (Today/Week/Month)

---

## Step 4: UI 打磨 + 通知操作 (持续)

### 4.1 通知操作处理

**文件**: `src-tauri/src/notification.rs`

**需要实现**:
- [ ] 注册通知点击回调
- [ ] 点击 "Task Completed" → 打开 Alice + 聚焦会话
- [ ] 点击 "Needs Input" → 复制 resume 命令
- [ ] 点击 "Error" → 显示错误详情

### 4.2 SessionCard 视觉增强

**文件**: `src/components/SessionCard.tsx`

**需要实现**:
- [ ] 添加状态指示器动画 (running pulse, error glow)
- [ ] 进度条 shimmer 效果
- [ ] Hover 显示更多操作按钮
- [ ] 时长实时更新

### 4.3 全局键盘快捷键增强

**文件**: `src/App.tsx`

**需要实现**:
- [ ] `Cmd+N` 聚焦到任务输入框
- [ ] `↑/↓` 列表导航
- [ ] `Delete` 删除选中项
- [ ] `Enter` 展开/执行选中项

### 4.4 Onboarding 完善

**文件**: `src/components/OnboardingWizard.tsx`

**需要实现**:
- [ ] Step 3: 扫描项目进度条
- [ ] 显示发现的会话数量
- [ ] CC Hooks 安装选项 (可选)

---

## 验收标准

### Step 1 完成标准
- [ ] 队列中的任务可以自动执行
- [ ] 执行结果正确保存到数据库
- [ ] OAuth 用量在 UsageMeter 中显示
- [ ] 用量百分比颜色正确

### Step 2 完成标准
- [ ] SessionCard 有 Resume 按钮
- [ ] 点击复制命令到剪贴板
- [ ] 搜索框输入后显示结果
- [ ] 可按项目过滤

### Step 3 完成标准
- [ ] 任务可以拖拽重排
- [ ] 每日使用柱状图显示
- [ ] 项目分解表格可排序

### Step 4 完成标准
- [ ] 通知可点击执行操作
- [ ] SessionCard 有正确的状态动画
- [ ] 所有键盘快捷键工作

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| OAuth API 需要有效凭证 | 无法测试用量获取 | 添加模拟数据模式 |
| claude CLI 不在 PATH | 队列执行失败 | 检测并提示安装 |
| 大量会话搜索慢 | 用户体验差 | 添加分页和索引优化 |
| dnd-kit 打包体积 | 增加 bundle size | 使用 tree-shaking |

---

## 时间线

```
Week 1 (立即)
├── Day 1-2: queue.rs 执行逻辑
├── Day 3-4: usage.rs OAuth 集成
└── Day 5: UsageMeter 前端集成

Week 2 (本周)
├── Day 1-2: SessionCard Resume 按钮
├── Day 3-4: SearchOverlay FTS 集成
└── Day 5: 项目过滤器

Week 3 (下周)
├── Day 1-2: dnd-kit 拖拽排序
├── Day 3-4: BarChart 组件
└── Day 5: UsageView 整合

Week 4+ (持续)
├── 通知操作
├── 动画效果
├── 键盘快捷键
└── Onboarding 完善
```
