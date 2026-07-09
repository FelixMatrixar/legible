/** Local agent run against one URL+goal, to see if the model forms valid
 *  actions. Usage: OPENROUTER_MODEL=... tsx scripts/agent-probe.ts <url> <goal> */
import "dotenv/config";
import { LlmClient } from "../packages/llm/src/client";
import { chromium } from "playwright";
import { buildNavGraph, type NavStateType } from "../services/agent-nav/src/graph";

const url = process.argv[2] ?? "https://example.com";
const goal = process.argv[3] ?? "find and click the primary call-to-action";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  const graph = buildNavGraph({ page, llm: new LlmClient(), maxSteps: 6 });
  const final = (await graph.invoke({ goal }, { recursionLimit: 40 })) as NavStateType;

  console.log(`model: ${process.env.OPENROUTER_MODEL}`);
  console.log(`goal:  ${goal}`);
  console.log(`outcome: ${final.outcome} in ${final.stepCount} step(s)`);
  for (const h of final.history) {
    console.log(`  ${h.step}. action="${h.action}" [${h.perceptionMode}] -> ${h.result}`);
  }
} finally {
  await browser.close();
}
