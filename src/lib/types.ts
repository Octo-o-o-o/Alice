// TypeScript types matching the Rust backend

export type SessionStatus = "idle" | "active" | "completed" | "error" | "needs_input";

// Theme setting
export type Theme = "system" | "light" | "dark";

// Terminal app setting
export type TerminalApp = "background" | "system" | "iterm2" | "windows_terminal" | "warp" | "custom";

export interface TerminalOption {
  value: string;
  label: string;
}

// App configuration
export interface AppConfig {
  onboarding_completed: boolean;
  launch_at_login: boolean;
  auto_hide_on_blur: boolean;
  notification_sound: boolean;
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
  theme: Theme;
  terminal_app: TerminalApp;
  custom_terminal_command: string;
  terminal_choice_made: boolean;
}

export interface QueueStartResult {
  started: boolean;
  needs_terminal_choice: boolean;
}

export interface Session {
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
  /** Detailed token breakdown */
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model: string | null;
  status: SessionStatus;
}

export interface SessionMessage {
  id: string | null;
  role: string;
  content: string;
  timestamp: number;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
}

export interface SessionDetail {
  session: Session;
  messages: SessionMessage[];
}

export type TaskStatus =
  | "backlog"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

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
}

export interface UsageStats {
  total_tokens: number;
  total_cost_usd: number;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  daily_usage: DailyUsage[];
  project_usage: ProjectUsage[];
}

export interface DailyUsage {
  date: string;
  tokens: number;
  cost_usd: number;
  session_count: number;
}

export interface ProjectUsage {
  project_name: string;
  project_path: string;
  tokens: number;
  cost_usd: number;
  session_count: number;
}

// Events from Rust backend
export interface SessionUpdateEvent {
  session_id: string;
  project_path: string;
  status: string;
}

// Live OAuth usage stats
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

// Queue status event
export interface QueueStatusEvent {
  is_running: boolean;
  current_task_id: string | null;
  queued_count: number;
}

// Daily report types
export interface DailyReport {
  date: string;
  sessions: SessionSummary[];
  git_commits: GitCommit[];
  usage_summary: ReportUsageSummary;
  pending_tasks: TaskSummary[];
  generated_at: number;
  markdown: string;
  ai_summary?: string;
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

// Anthropic service status
export interface AnthropicStatus {
  status: string; // "none" | "minor" | "major" | "critical"
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

// Onboarding status for setup wizard
export interface OnboardingStatus {
  cli_installed: boolean;
  cli_version: string | null;
  credentials_found: boolean;
  account_email: string | null;
  subscription_type: 'max' | 'pro' | 'free' | 'team' | 'enterprise' | null;
  claude_dir_exists: boolean;
  platform: 'macos' | 'windows' | 'linux';
  hooks_installed: boolean;
  existing_sessions_count: number;
}

// Hook verification result
export interface HookVerifyResult {
  success: boolean;
  settings_path: string;
  hooks_file: string;
  session_start_installed: boolean;
  session_end_installed: boolean;
}

// System info for config view
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

// Scan result for directory scanning
export interface ScanResult {
  session_count: number;
  project_count: number;
  total_tokens: number;
  projects: string[];
}

// Favorite prompt
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
