import "dotenv/config";
import { createBus, GROUPS, LiveState, TOPICS } from "@legible/bus";
import { saveAgentResults } from "@legible/db";
import { LlmClient } from "@legible/llm";
import type { AgentResultEvent, PageJob } from "@legible/shared";
import { hostname } from "node:os";
import { chromium, type Browser } from "playwright";
import { runGoalsForPage } from "./runner";

const bus = createBus();
const live = new LiveState();
const llm = new LlmClient();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // See structure-audit/src/index.ts for why these two flags are needed
    // on PaaS containers (Render, Heroku, etc.), not just resource limits.
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
  }
  return browser;
}

async function handleJob(job: PageJob): Promise<void> {
  console.log(`[agent-nav] ${job.url} — ${job.goals.length} goal(s)`);
  const result: AgentResultEvent = { batchId: job.batchId, pageId: job.pageId, url: job.url, goals: [] };

  try {
    result.goals = await runGoalsForPage(await getBrowser(), llm, job);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[agent-nav] failed for ${job.url}:`, err);
  }

  await saveAgentResults(job.pageId, result.goals);
  await bus.publish(TOPICS.agentResults, result);
  await live.incrProgress(job.batchId, "agentDone");
  await live.emit({
    type: "agent-done",
    batchId: job.batchId,
    pageId: job.pageId,
    url: job.url,
    detail: result.goals.map((g) => `${g.goal}: ${g.outcome}`).join("; ") || result.error,
  });
}

const consumer = `${hostname()}-${process.pid}`;
bus.consume<PageJob>(TOPICS.pagesToAudit, GROUPS.agentNav, consumer, handleJob).catch((err) => {
  console.error("[agent-nav] consumer crashed:", err);
  process.exit(1);
});
