/** Local check that extractPageFacts survives tsx→page.evaluate serialization. */
import { chromium } from "playwright";
import { auditStructure } from "../services/structure-audit/src/audit";
import { listInteractiveElements } from "../services/agent-nav/src/tools";

const browser = await chromium.launch({ headless: true });
try {
  const signals = await auditStructure(browser, "https://example.com");
  console.log("structure signals OK:", JSON.stringify({
    title: signals.title,
    headings: signals.headings,
    aria: { total: signals.aria.totalInteractive, named: signals.aria.named },
    jsOnly: signals.jsOnly.detected,
  }));

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
  const perception = await listInteractiveElements(page);
  console.log("agent perception OK:", JSON.stringify(perception.elements));
  await context.close();
} finally {
  await browser.close();
}
