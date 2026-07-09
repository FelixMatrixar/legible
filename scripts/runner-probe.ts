/** Runs the full per-goal runner (incl. recursion limit) against one URL. */
import "dotenv/config";
import { chromium } from "playwright";
import { LlmClient } from "../packages/llm/src/client";
import { runGoalsForPage } from "../services/agent-nav/src/runner";

const url = process.argv[2] ?? "https://example.com";
const goal = process.argv[3] ?? "find the main heading";

const browser = await chromium.launch({ headless: true });
try {
  const results = await runGoalsForPage(browser, new LlmClient(), {
    batchId: "probe",
    pageId: "probe",
    url,
    environment: "production",
    goals: [{ goal, classificationOverride: "read-only" }],
  });
  for (const r of results) {
    console.log(`goal: ${r.goal} -> ${r.outcome} in ${r.stepsTaken} step(s)`);
    for (const h of r.history) console.log(`  ${h.step}. ${h.action} [${h.perceptionMode}] -> ${h.result}`);
  }
} finally {
  await browser.close();
}
