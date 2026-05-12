// Local mirrors of the wire shapes the dashboard consumes (kept out of the
// backend workspace packages so Vite never has to transpile linked deps).

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

export interface BatchListItem {
  id: string;
  name: string;
  status: string;
  environment: string;
  summary: {
    avgScore: number;
    pageCount: number;
    patterns: { templateId: string; severity: string; pagesAffected: number; sample: string }[];
  } | null;
  created_at: string;
  completed_at: string | null;
}

export interface BatchDetail {
  batch: BatchListItem;
  pages: { id: string; url: string; goals: unknown[] }[];
  scores: { id: string; page_id: string; url: string; score: number; prior_score: number | null }[];
  progress: Record<string, string>;
}

export interface FindingRow {
  id: string;
  template_id: string;
  severity: "critical" | "major" | "minor";
  message: string;
  evidence: unknown;
}

export interface PageReport {
  page: { id: string; url: string };
  structure: { signals: unknown; error: string | null } | null;
  agentResults: {
    goal: string;
    outcome: string;
    steps_taken: number;
    perception_mode: string | null;
    history: { step: number; action: string; perceptionMode: string; result: string }[];
    skipped_reason: string | null;
    teardown_outcome: string | null;
  }[];
  score: { score: number; prior_score: number | null } | null;
  findings: FindingRow[];
}
