import { getBatch } from "@legible/db";

interface Rollup {
  avgScore: number;
  pageCount: number;
  patterns: { templateId: string; severity: string; pagesAffected: number; sample: string }[];
}

/**
 * Batch-completion notification. The payload carries both `text` (Slack)
 * and `content` (Discord) so a plain incoming-webhook URL of either kind
 * renders something readable, plus the structured summary for anything else.
 */
export async function sendCompletionWebhook(batchId: string, summary: Rollup): Promise<void> {
  let url = process.env.WEBHOOK_URL;
  try {
    const { batch } = await getBatch(batchId);
    if (batch?.webhook_url) url = batch.webhook_url;
  } catch {
    /* fall back to the env-level webhook */
  }
  if (!url) return;

  const topPatterns = summary.patterns
    .slice(0, 5)
    .map((p) => `• [${p.severity}] ${p.templateId}: ${p.pagesAffected} page(s) — e.g. "${p.sample}"`)
    .join("\n");

  const message =
    `legible: batch complete — average score ${summary.avgScore}/100 across ${summary.pageCount} page(s).` +
    (topPatterns ? `\nTop patterns:\n${topPatterns}` : "\nNo findings — clean batch.");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message, batchId, summary }),
    });
    if (!res.ok) {
      console.error(`[webhook] delivery failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("[webhook] delivery error:", err);
  }
}
