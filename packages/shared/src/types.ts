export type Severity = "critical" | "major" | "minor";
export type GoalClassification = "read-only" | "mutating";
export type TargetEnvironment = "staging" | "production";
export type PerceptionMode = "accessible-name" | "visual-fallback";

/** One goal the navigation agent should attempt against a page. */
export interface GoalSpec {
  goal: string;
  /** Primary conversion goal — visual-fallback here is a Major finding. */
  primary?: boolean;
  /** Operator override for the read-only/mutating classifier. Logged when used. */
  classificationOverride?: GoalClassification;
  /** Cleanup goal run after a mutating goal succeeds (e.g. "cancel the order just placed"). */
  teardownGoal?: string;
}

/** The event published to `pages-to-audit`; both audit stages consume it. */
export interface PageJob {
  batchId: string;
  pageId: string;
  url: string;
  environment: TargetEnvironment;
  goals: GoalSpec[];
}

export interface HistoryEntry {
  step: number;
  action: string;
  perceptionMode: PerceptionMode;
  result: string;
}

export type GoalOutcome = "succeeded" | "failed" | "stuck" | "skipped" | "error";

export interface GoalResult {
  goal: string;
  primary: boolean;
  classification: GoalClassification;
  outcome: GoalOutcome;
  stepsTaken: number;
  /** Perception mode of the winning action (or of the final attempt on failure). */
  perceptionModeAtEnd: PerceptionMode;
  history: HistoryEntry[];
  /** Set when outcome is "skipped" (e.g. mutating goal against production). */
  skippedReason?: string;
  teardownOutcome?: GoalOutcome;
}

export interface AgentResultEvent {
  batchId: string;
  pageId: string;
  url: string;
  goals: GoalResult[];
  error?: string;
}

export interface HeadingSkip {
  from: number;
  to: number;
}

export interface StructureSignals {
  title: { present: boolean; value: string };
  metaDescription: { present: boolean; value: string };
  structuredData: { present: boolean; blocks: number; valid: boolean };
  headings: { order: number[]; h1Count: number; skips: HeadingSkip[] };
  altText: { total: number; withAlt: number; coverage: number };
  aria: { totalInteractive: number; named: number; coverage: number; unnamedSamples: string[] };
  jsOnly: { detected: boolean; samples: string[] };
}

export interface StructureResultEvent {
  batchId: string;
  pageId: string;
  url: string;
  signals: StructureSignals | null;
  error?: string;
}

export interface Finding {
  templateId: string;
  severity: Severity;
  message: string;
  evidence?: unknown;
}

export interface PageScoreResult {
  pageId: string;
  batchId: string;
  url: string;
  score: number;
  priorScore: number | null;
  findings: Finding[];
}

/** Events tailed by the API and pushed to the dashboard over WebSocket. */
export interface LiveEvent {
  type:
    | "batch-submitted"
    | "page-queued"
    | "structure-done"
    | "agent-done"
    | "page-scored"
    | "batch-complete";
  batchId: string;
  pageId?: string;
  url?: string;
  score?: number;
  detail?: string;
  at: string;
}
