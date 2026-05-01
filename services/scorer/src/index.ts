import "dotenv/config";
import { createBus, GROUPS, LiveState, TOPICS } from "@legible/bus";
import {
  batchRollup,
  completeBatch,
  countScoredPages,
  getPriorScore,
  savePageScore,
} from "@legible/db";
import {
  generateFindings,
  scorePage,
  type AgentResultEvent,
  type StructureResultEvent,
} from "@legible/shared";
import { hostname } from "node:os";
import { sendCompletionWebhook } from "./webhook";

const bus = createBus();
const live = new LiveState();

/**
 * Join point of the pipeline: a page is scored once BOTH its navigation
 * result and its structural result have arrived. Partial results are parked
 * in Redis; a SET NX claim guarantees exactly one scorer scores a page even
 * with multiple instances running.
 */
async function onPart(
  pageId: string,
  part: "agent" | "structure",
  event: AgentResultEvent | StructureResultEvent
): Promise<void> {
  await live.setJoinPart(pageId, part, event);
  const join = await live.getJoin(pageId);
  if (!join.agent || !join.structure) return;
  if (!(await live.claimScoring(pageId))) return;

  const agent = JSON.parse(join.agent) as AgentResultEvent;
  const structure = JSON.parse(join.structure) as StructureResultEvent;

  const findings = generateFindings(structure.signals, agent.goals);
  if (structure.error) {
    findings.push({
      templateId: "STRUCTURE_AUDIT_ERROR",
      severity: "major",
      message: `Structural audit could not complete: ${structure.error}`,
    });
  }
  if (agent.error) {
    findings.push({
      templateId: "AGENT_AUDIT_ERROR",
      severity: "major",
      message: `Navigation audit could not complete: ${agent.error}`,
    });
  }

  const score = scorePage(findings);
  const priorScore = await getPriorScore(agent.url, agent.batchId);

  await savePageScore({
    pageId,
    batchId: agent.batchId,
    url: agent.url,
    score,
    priorScore,
    findings,
  });
  await live.incrProgress(agent.batchId, "scored");
  await live.emit({
    type: "page-scored",
    batchId: agent.batchId,
    pageId,
    url: agent.url,
    score,
    detail:
      priorScore !== null
        ? `prior ${priorScore} → now ${score}`
        : `${findings.length} finding(s)`,
  });
  console.log(`[scorer] ${agent.url} → ${score} (${findings.length} findings)`);

  await maybeCompleteBatch(agent.batchId);
}

async function maybeCompleteBatch(batchId: string): Promise<void> {
  const { scored, total } = await countScoredPages(batchId);
  if (total === 0 || scored < total) return;

  const summary = await batchRollup(batchId);
  await completeBatch(batchId, summary);
  await live.emit({
    type: "batch-complete",
    batchId,
    detail: `avg score ${summary.avgScore} across ${summary.pageCount} pages`,
  });
  await sendCompletionWebhook(batchId, summary);
  console.log(`[scorer] batch ${batchId} complete — avg ${summary.avgScore}`);
}

const consumer = `${hostname()}-${process.pid}`;
Promise.all([
  bus.consume<AgentResultEvent>(TOPICS.agentResults, GROUPS.scorer, consumer, (msg) =>
    onPart(msg.pageId, "agent", msg)
  ),
  bus.consume<StructureResultEvent>(TOPICS.structureResults, GROUPS.scorer, consumer, (msg) =>
    onPart(msg.pageId, "structure", msg)
  ),
]).catch((err) => {
  console.error("[scorer] consumer crashed:", err);
  process.exit(1);
});
