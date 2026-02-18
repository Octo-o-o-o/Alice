// TypeScript types matching the Rust backend structs.
// IMPORTANT: Field names and types must stay in sync with the Rust backend.

// ---------------------------------------------------------------------------
// Enums and union types
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "idle"
  | "active"
  | "completed"
  | "error"
  | "needs_input";

export type ProviderId = "claude" | "codex" | "gemini";

export type Theme = "system" | "light" | "dark";

export type TerminalApp =
  | "background"
  | "system"
  | "iterm2"
  | "windows_terminal"
  | "warp"
  | "custom";

export type AutoActionType = "none" | "sleep" | "shutdown";

export type TaskStatus =
  | "backlog"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type ImageSourceType = "base64" | "path";

export type ServiceImpact = "none" | "minor" | "major" | "critical";

export type SubscriptionType = "max" | "pro" | "free" | "team" | "enterprise";

export type Platform = "macos" | "windows" | "linux";

// ---------------------------------------------------------------------------
// Shared field groups (used via intersection to reduce duplication)
// ---------------------------------------------------------------------------

/** Fields common to usage aggregations: tokens, cost, and session count. */
interface UsageMetrics {
  tokens: number;
  cost_usd: number;
  session_count: number;
}

/** Detailed token breakdown used by Session and UsageStats. */
interface TokenBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AutoActionConfig {
  enabled: boolean;
  action_type: AutoActionType;
  delay_minutes: number;
}

export interface AutoActionState {
  timer_active: boolean;
  action_type: string;
  remaining_seconds: number;
  total_seconds: number;
}

export interface ClaudeEnvironment {
  id: string;
  name: string;
  config_dir: string;
  api_key?: string | null;
  model?: string | null;
  command?: string | null;
  enabled: boolean;
}

export interface TerminalOption {
  value: string;
  label: string;
}

export interface AppConfig {
  onboarding_completed: boolean;
  launch_at_login: boolean;
  auto_hide_on_blur: boolean;
  notification_sound: boolean;
  voice_notifications: boolean;
  notifications: {
    on_task_completed: boolean;
    on_task_error: boolean;
    on_needs_input: boolean;
    on_queue_started: boolean;
    on_daily_report: boolean;
  };
  hooks_installed: boolean;
  data_retention_days: number;
  daily_report_time: string;
  report_language: string;
  theme: Theme;
  terminal_app: TerminalApp;
  custom_terminal_command: string;
  terminal_choice_made: boolean;
  auto_action: AutoActionConfig;
  claude_environments: ClaudeEnvironment[];
  active_environment_id?: string | null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface Session extends TokenBreakdown {
  session_id: string;
  project_path: string;
  project_name: string;
  first_prompt: string | null;
  label: string | null;
  tags: string[];
  started_at: number;
  last_active_at: number;
  /** Timestamp of the last human/user message (for stable sorting) */
  last_human_message_at: number;
  message_count: number;
  total_tokens: number;
  total_cost_usd: number;
  model: string | null;
  status: SessionStatus;
  provider: ProviderId;
}

export interface SessionMessage {
  id: string | null;
  role: string;
  content: string;
  timestamp: number;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
  images: ImageContent[];
}

export interface ImageContent {
  source_type: ImageSourceType;
  media_type: string | null;
  data: string | null;
  path: string | null;
}

export interface SessionDetail {
  session: Session;
  messages: SessionMessage[];
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  prompt: string;
  project_path: string | null;
  status: TaskStatus;
  priority: string;
  execution_mode: string;
  depends_on: string | null;
  session_id: string | null;
  system_prompt: string | null;
  allowed_tools: string | null;
  max_budget_usd: number | null;
  max_turns: number | null;
  notes: string | null;
  tags: string | null;
  sort_order: number;
  result_exit_code: number | null;
  result_output: string | null;
  result_tokens: number | null;
  result_cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  provider: ProviderId;
}

export interface QueueStartResult {
  started: boolean;
  needs_terminal_choice: boolean;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface UsageStats extends TokenBreakdown {
  total_tokens: number;
  total_cost_usd: number;
  session_count: number;
  daily_usage: DailyUsage[];
  project_usage: ProjectUsage[];
}

export interface DailyUsage extends UsageMetrics {
  date: string;
}

export interface ProjectUsage extends UsageMetrics {
  project_name: string;
  project_path: string;
}

export interface LiveUsageStats {
  session_percent: number;
  session_reset_at: string | null;
  weekly_percent: number;
  weekly_reset_at: string | null;
  burn_rate_per_hour: number | null;
  estimated_limit_in_minutes: number | null;
  account_email: string | null;
  account_plan: string | null;
  last_updated: number;
  error: string | null;
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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface SessionUpdateEvent {
  session_id: string;
  project_path: string;
  status: string;
}

export interface QueueStatusEvent {
  is_running: boolean;
  current_task_id: string | null;
  queued_count: number;
}

// ---------------------------------------------------------------------------
// Daily reports
// ---------------------------------------------------------------------------

export interface DailyReport {
  date: string;
  sessions: SessionSummary[];
  git_commits: GitCommit[];
  usage_summary: ReportUsageSummary;
  pending_tasks: TaskSummary[];
  generated_at: number;
  markdown: string;
  ai_summary?: string;
  work_value_score?: number;
  workload_score?: number;
}

export interface SessionSummary {
  project_name: string;
  prompt: string;
  status: string;
  tokens: number;
  cost_usd: number;
  duration_minutes: number;
}

export interface GitCommit {
  project_name: string;
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  is_cc_assisted: boolean;
}

export interface ReportUsageSummary {
  total_sessions: number;
  total_tokens: number;
  total_cost_usd: number;
  by_project: ReportProjectUsage[];
}

export interface ReportProjectUsage {
  project_name: string;
  sessions: number;
  tokens: number;
  cost_usd: number;
}

export interface TaskSummary {
  prompt: string;
  project_name: string | null;
  priority: string;
}

// ---------------------------------------------------------------------------
// Service status
// ---------------------------------------------------------------------------

export interface AnthropicStatus {
  status: ServiceImpact;
  description: string;
  incidents: StatusIncident[];
  last_updated: number;
}

export interface StatusIncident {
  name: string;
  status: string;
  impact: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Onboarding and system info
// ---------------------------------------------------------------------------

export interface OnboardingStatus {
  cli_installed: boolean;
  cli_version: string | null;
  credentials_found: boolean;
  account_email: string | null;
  subscription_type: SubscriptionType | null;
  claude_dir_exists: boolean;
  platform: Platform;
  hooks_installed: boolean;
  existing_sessions_count: number;
}

export interface HookVerifyResult {
  success: boolean;
  settings_path: string;
  hooks_file: string;
  session_start_installed: boolean;
  session_end_installed: boolean;
}

export interface SystemInfo {
  claude_installed: boolean;
  claude_version: string | null;
  credentials_exist: boolean;
  account_email: string | null;
  db_stats: {
    db_size_bytes: number;
    report_count: number;
  };
}

export interface ScanResult {
  session_count: number;
  project_count: number;
  total_tokens: number;
  projects: string[];
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export interface Favorite {
  id: string;
  name: string;
  prompt: string;
  project_path: string | null;
  tags: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Provider status
// ---------------------------------------------------------------------------

export interface ProviderStatus {
  id: ProviderId;
  display_name: string;
  installed: boolean;
  version: string | null;
  data_dir: string;
  enabled: boolean;
  custom_data_dir: string | null;
}

// ---------------------------------------------------------------------------
// Window system and tool platform entities
// ---------------------------------------------------------------------------

export type WindowRole = "quick" | "main";

export interface WindowContext {
  label: string;
  role: WindowRole;
  default_route: string;
}

export type RunStatus = "queued" | "running" | "blocked" | "completed" | "failed";

export type GateDecision = "pending" | "approved" | "rejected" | "deferred";

export type RiskLevel = "low" | "medium" | "high";

export interface ToolPhase {
  phase_id: string;
  name: string;
  status: RunStatus;
  dod: string[];
  verification_summary: string;
  rollback_notes: string | null;
}

export interface ToolGate {
  gate_id: string;
  run_id: string;
  phase_id: string;
  title: string;
  reason: string;
  decision: GateDecision;
  created_at: number;
}

export interface ToolArtifact {
  artifact_id: string;
  run_id: string;
  phase_id: string | null;
  kind: "md" | "json" | "log";
  title: string;
  path: string;
  created_at: number;
}

export interface ToolRun {
  run_id: string;
  tool_id: string;
  project_name: string;
  provider: ProviderId;
  status: RunStatus;
  current_phase_id: string | null;
  started_at: number;
  updated_at: number;
  score_before: number | null;
  score_after: number | null;
  residual_risk: string | null;
}

export interface ToolManifest {
  tool_id: string;
  name: string;
  category: string;
  risk_level: RiskLevel;
  entry_routes: {
    quick: string[];
    main: string[];
  };
  state_machine: {
    steps: string[];
    gates: string[];
    retry_policy: string;
  };
  input_schema: string;
  output_schema: string;
  artifact_spec: string[];
  quick_actions: string[];
  permissions: {
    allow_auto_modify_code: boolean;
    allow_auto_commit: boolean;
  };
}
