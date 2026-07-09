/** Prints the interactive-element list the planner reasons over. */
import { chromium } from "playwright";
import { listInteractiveElements } from "../services/agent-nav/src/tools";

const url = process.argv[2] ?? "https://example.com";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const p = await listInteractiveElements(page);
  for (const e of p.elements.slice(0, 20)) {
    console.log(`${e.ref} [${e.role}] "${e.accessibleName}" @ (${e.boundingBox.x},${e.boundingBox.y}) ${e.boundingBox.width}x${e.boundingBox.height}`);
  }
} finally {
  await browser.close();
}
