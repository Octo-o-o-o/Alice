import type { ToolArtifact, ToolGate, ToolManifest, ToolPhase, ToolRun } from "./types";

export const TOOL_MANIFESTS: ToolManifest[] = [
  {
    tool_id: "optimization-audit",
    name: "Optimization Audit",
    category: "governance",
    risk_level: "high",
    entry_routes: {
      quick: ["/quick/running", "/quick/gates/:gateId"],
      main: ["/app/tools/optimization-audit", "/app/runs/:runId/phases/:phaseId"],
    },
    state_machine: {
      steps: ["baseline", "issue_merge", "phase_execution", "verification", "final_report"],
      gates: ["phase-acceptance", "high-risk-change"],
      retry_policy: "failed step can retry up to 3 times before run is marked failed",
    },
    input_schema: "repo_path, baseline_ref, quality_targets, provider_strategy",
    output_schema: "phase_results, score_compare, residual_risk, final_recommendation",
    artifact_spec: ["baseline.md", "issues.json", "phase-report.md", "audit-report.md"],
    quick_actions: ["approve", "reject", "defer", "open-main-window"],
    permissions: {
      allow_auto_modify_code: true,
      allow_auto_commit: false,
    },
  },
];

const now = Date.now();

export const SAMPLE_RUNS: ToolRun[] = [
  {
    run_id: "R-88",
    tool_id: "optimization-audit",
    project_name: "Alice",
    provider: "claude",
    status: "running",
    current_phase_id: "P-02",
    started_at: now - 1000 * 60 * 42,
    updated_at: now - 1000 * 35,
    score_before: 73,
    score_after: null,
    residual_risk: null,
  },
  {
    run_id: "R-79",
    tool_id: "optimization-audit",
    project_name: "Alice",
    provider: "codex",
    status: "completed",
    current_phase_id: null,
    started_at: now - 1000 * 60 * 60 * 30,
    updated_at: now - 1000 * 60 * 60 * 28,
    score_before: 68,
    score_after: 84,
    residual_risk: "minor test coverage debt",
  },
];

export const SAMPLE_PHASES: Record<string, ToolPhase[]> = {
  "R-88": [
    {
      phase_id: "P-01",
      name: "Issue Baseline",
      status: "completed",
      dod: ["collect baseline metrics", "persist issue index"],
      verification_summary: "baseline metrics captured",
      rollback_notes: null,
    },
    {
      phase_id: "P-02",
      name: "Refactor High-Impact Paths",
      status: "running",
      dod: ["apply targeted refactors", "run build verification"],
      verification_summary: "build pending",
      rollback_notes: null,
    },
  ],
  "R-79": [
    {
      phase_id: "P-01",
      name: "Issue Merge",
      status: "completed",
      dod: ["merge multi-model findings", "deduplicate issue list"],
      verification_summary: "issue board generated",
      rollback_notes: null,
    },
    {
      phase_id: "P-02",
      name: "Validation and Report",
      status: "completed",
      dod: ["run validation checks", "generate final report"],
      verification_summary: "all checks passed",
      rollback_notes: "rollback script stored at artifacts/rollback.sh",
    },
  ],
};

export const SAMPLE_GATES: ToolGate[] = [
  {
    gate_id: "G-203",
    run_id: "R-88",
    phase_id: "P-02",
    title: "Approve phase P-02 rollout",
    reason: "touches queue scheduling logic with medium runtime risk",
    decision: "pending",
    created_at: now - 1000 * 60 * 8,
  },
];

export const SAMPLE_ARTIFACTS: ToolArtifact[] = [
  {
    artifact_id: "A-001",
    run_id: "R-88",
    phase_id: "P-01",
    kind: "md",
    title: "Baseline Report",
    path: "~/.alice/runs/R-88/baseline.md",
    created_at: now - 1000 * 60 * 40,
  },
  {
    artifact_id: "A-002",
    run_id: "R-88",
    phase_id: "P-02",
    kind: "json",
    title: "Issue Merge Output",
    path: "~/.alice/runs/R-88/issues.json",
    created_at: now - 1000 * 60 * 18,
  },
];
