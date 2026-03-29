import { UpstashRedis } from "@legible/bus";
import type {
  Finding,
  GoalResult,
  GoalSpec,
  StructureSignals,
  TargetEnvironment,
} from "@legible/shared";
import { randomUUID } from "node:crypto";

/**
 * Durable result store on Upstash Redis. The spec scopes querying to
 * "simple lookup by batch/page id", which maps to plain keys:
 *
 *   batch:{id}            batch JSON
 *   batch:{id}:pages      list of page ids
 *   batch:{id}:scored     counter for completion detection
 *   batches:recent        list of recent batch ids (capped)
 *   page:{id}             page JSON
 *   page:{id}:structure   structural signals JSON
 *   page:{id}:agent       agent goal-result rows JSON
 *   page:{id}:score       score + findings JSON
 *   history:{url}         per-URL score history (capped) — spec §2.5 lookup
 */

const redis = new UpstashRedis();
const RECENT_BATCHES = 100;
const URL_HISTORY = 50;

interface BatchRow {
  id: string;
  name: string;
  status: string;
  environment: TargetEnvironment;
  webhook_url: string | null;
  created_by: string;
  summary: unknown;
  created_at: string;
  completed_at: string | null;
}

interface PageRow {
  id: string;
  batch_id: string;
  url: string;
  goals: GoalSpec[];
  created_at: string;
}

interface ScoreRow {
  page_id: string;
  batch_id: string;
  url: string;
  score: number;
  prior_score: number | null;
  findings: Finding[];
  created_at: string;
}

export interface NewBatch {
  name: string;
  environment: TargetEnvironment;
  webhookUrl?: string;
  createdBy: string;
  pages: { url: string; goals: GoalSpec[] }[];
}

export interface CreatedBatch {
  batchId: string;
  pages: { pageId: string; url: string; goals: GoalSpec[] }[];
}

const parse = <T>(raw: string | null): T | null => (raw ? (JSON.parse(raw) as T) : null);

export async function createBatch(input: NewBatch): Promise<CreatedBatch> {
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const batch: BatchRow = {
    id: batchId,
    name: input.name,
    status: "running",
    environment: input.environment,
    webhook_url: input.webhookUrl ?? null,
    created_by: input.createdBy,
    summary: null,
    created_at: now,
    completed_at: null,
  };

  const pages = input.pages.map((p) => ({ pageId: randomUUID(), url: p.url, goals: p.goals }));

  const commands: (string | number)[][] = [
    ["SET", `batch:${batchId}`, JSON.stringify(batch)],
    ["LPUSH", "batches:recent", batchId],
    ["LTRIM", "batches:recent", 0, RECENT_BATCHES - 1],
  ];
  for (const p of pages) {
    const row: PageRow = {
      id: p.pageId,
      batch_id: batchId,
      url: p.url,
      goals: p.goals,
      created_at: now,
    };
    commands.push(["SET", `page:${p.pageId}`, JSON.stringify(row)]);
    commands.push(["RPUSH", `batch:${batchId}:pages`, p.pageId]);
  }
  await redis.pipeline(commands);

  return { batchId, pages };
}

export async function saveStructureResult(
  pageId: string,
  signals: StructureSignals | null,
  error?: string
): Promise<void> {
  await redis.cmd(
    "SET",
    `page:${pageId}:structure`,
    JSON.stringify({ signals, error: error ?? null, created_at: new Date().toISOString() })
  );
}

export async function saveAgentResults(pageId: string, goals: GoalResult[]): Promise<void> {
  const rows = goals.map((g) => ({
    goal: g.goal,
    classification: g.classification,
    outcome: g.outcome,
    steps_taken: g.stepsTaken,
    perception_mode: g.perceptionModeAtEnd,
    history: g.history,
    skipped_reason: g.skippedReason ?? null,
    teardown_outcome: g.teardownOutcome ?? null,
  }));
  await redis.cmd("SET", `page:${pageId}:agent`, JSON.stringify(rows));
}

/** Spec §2.5: comparing against the previous run is a lookup, not a recompute. */
export async function getPriorScore(url: string, excludeBatchId: string): Promise<number | null> {
  const entries = await redis.cmd<string[] | null>("LRANGE", `history:${url}`, 0, 5);
  for (const raw of entries ?? []) {
    const entry = parse<{ batch_id: string; score: number }>(raw);
    if (entry && entry.batch_id !== excludeBatchId) return entry.score;
  }
  return null;
}

export async function savePageScore(input: {
  pageId: string;
  batchId: string;
  url: string;
  score: number;
  priorScore: number | null;
  findings: Finding[];
}): Promise<void> {
  const now = new Date().toISOString();
  const row: ScoreRow = {
    page_id: input.pageId,
    batch_id: input.batchId,
    url: input.url,
    score: input.score,
    prior_score: input.priorScore,
    findings: input.findings,
    created_at: now,
  };
  await redis.pipeline([
    ["SET", `page:${input.pageId}:score`, JSON.stringify(row)],
    ["INCR", `batch:${input.batchId}:scored`],
    ["LPUSH", `history:${input.url}`, JSON.stringify({ batch_id: input.batchId, score: input.score, at: now })],
    ["LTRIM", `history:${input.url}`, 0, URL_HISTORY - 1],
  ]);
}

export async function countScoredPages(batchId: string): Promise<{ scored: number; total: number }> {
  const [scored, total] = await redis.pipeline<number | null>([
    ["GET", `batch:${batchId}:scored`],
    ["LLEN", `batch:${batchId}:pages`],
  ]);
  return { scored: Number(scored ?? 0), total: Number(total ?? 0) };
}

async function pageIdsOf(batchId: string): Promise<string[]> {
  return (await redis.cmd<string[] | null>("LRANGE", `batch:${batchId}:pages`, 0, -1)) ?? [];
}

async function mget<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  const raw = await redis.cmd<(string | null)[]>("MGET", ...keys);
  return raw.map((r) => parse<T>(r));
}

/** Batch rollup (spec §2.4): group-by finding template across the batch. */
export async function batchRollup(batchId: string): Promise<{
  avgScore: number;
  pageCount: number;
  patterns: { templateId: string; severity: string; pagesAffected: number; sample: string }[];
}> {
  const ids = await pageIdsOf(batchId);
  const scores = (await mget<ScoreRow>(ids.map((id) => `page:${id}:score`))).filter(
    (s): s is ScoreRow => s !== null
  );

  const byTemplate = new Map<string, { severity: string; pages: Set<string>; sample: string }>();
  for (const s of scores) {
    for (const f of s.findings) {
      const entry = byTemplate.get(f.templateId) ?? {
        severity: f.severity,
        pages: new Set<string>(),
        sample: f.message,
      };
      entry.pages.add(s.page_id);
      byTemplate.set(f.templateId, entry);
    }
  }

  const pageCount = scores.length;
  const avgScore = pageCount
    ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / pageCount)
    : 0;

  return {
    avgScore,
    pageCount,
    patterns: [...byTemplate.entries()]
      .map(([templateId, e]) => ({
        templateId,
        severity: e.severity,
        pagesAffected: e.pages.size,
        sample: e.sample,
      }))
      .sort((a, b) => b.pagesAffected - a.pagesAffected),
  };
}

export async function completeBatch(batchId: string, summary: unknown): Promise<void> {
  const batch = parse<BatchRow>(await redis.cmd<string | null>("GET", `batch:${batchId}`));
  if (!batch) throw new Error(`completeBatch: batch ${batchId} not found`);
  batch.status = "complete";
  batch.summary = summary;
  batch.completed_at = new Date().toISOString();
  await redis.cmd("SET", `batch:${batchId}`, JSON.stringify(batch));
}

export async function getBatch(batchId: string) {
  const batch = parse<BatchRow>(await redis.cmd<string | null>("GET", `batch:${batchId}`));
  if (!batch) throw new Error(`getBatch: batch ${batchId} not found`);

  const ids = await pageIdsOf(batchId);
  const pages = (await mget<PageRow>(ids.map((id) => `page:${id}`))).filter(
    (p): p is PageRow => p !== null
  );
  const scores = (await mget<ScoreRow>(ids.map((id) => `page:${id}:score`)))
    .filter((s): s is ScoreRow => s !== null)
    .map((s) => ({ id: s.page_id, ...s }));

  return { batch, pages, scores };
}

export async function listBatches(limit = 20) {
  const ids = (await redis.cmd<string[] | null>("LRANGE", "batches:recent", 0, limit - 1)) ?? [];
  return (await mget<BatchRow>(ids.map((id) => `batch:${id}`))).filter(
    (b): b is BatchRow => b !== null
  );
}

export async function getPageReport(pageId: string) {
  const [pageRaw, structureRaw, agentRaw, scoreRaw] = await redis.pipeline<string | null>([
    ["GET", `page:${pageId}`],
    ["GET", `page:${pageId}:structure`],
    ["GET", `page:${pageId}:agent`],
    ["GET", `page:${pageId}:score`],
  ]);
  const page = parse<PageRow>(pageRaw);
  if (!page) throw new Error(`getPageReport: page ${pageId} not found`);

  const score = parse<ScoreRow>(scoreRaw);
  return {
    page,
    structure: parse<{ signals: StructureSignals | null; error: string | null }>(structureRaw),
    agentResults: parse<unknown[]>(agentRaw) ?? [],
    score,
    findings: (score?.findings ?? []).map((f, i) => ({
      id: `${pageId}-${i}`,
      template_id: f.templateId,
      severity: f.severity,
      message: f.message,
      evidence: f.evidence ?? null,
    })),
  };
}
