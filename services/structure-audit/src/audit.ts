import {
  extractPageFacts,
  type HeadingSkip,
  type PageFacts,
  type StructureSignals,
} from "@legible/shared";
import type { Browser } from "playwright";

const NAV_TIMEOUT_MS = 45_000;

/**
 * Structural audit: fetch the raw HTTP body (what a non-JS crawler sees),
 * render the same URL in a real browser (what a human/agent sees), extract
 * the signals, and diff the two to flag JS-only content.
 */
export async function auditStructure(browser: Browser, url: string): Promise<StructureSignals> {
  const rawPromise = fetchRawHtml(url);

  const context = await browser.newContext({
    userAgent: "legible-audit/0.1 (structural; +https://github.com/legible)",
    viewport: { width: 1366, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // networkidle is best-effort: analytics-heavy pages never go idle.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const facts = await page.evaluate(extractPageFacts, false);
    const rawHtml = await rawPromise;
    return buildSignals(facts, rawHtml);
  } finally {
    await context.close();
  }
}

async function fetchRawHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "legible-audit/0.1 (raw; non-JS consumer simulation)" },
      redirect: "follow",
      signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
    });
    return await res.text();
  } catch (err) {
    console.error(`[structure] raw fetch failed for ${url}:`, err);
    return "";
  }
}

export function buildSignals(facts: PageFacts, rawHtml: string): StructureSignals {
  let structuredDataValid = facts.jsonLdBlocks.length > 0;
  for (const block of facts.jsonLdBlocks) {
    try {
      JSON.parse(block);
    } catch {
      structuredDataValid = false;
    }
  }

  const skips: HeadingSkip[] = [];
  for (let i = 1; i < facts.headingOrder.length; i++) {
    const prev = facts.headingOrder[i - 1];
    const cur = facts.headingOrder[i];
    if (cur > prev + 1) skips.push({ from: prev, to: cur });
  }

  const named = facts.interactive.filter((e) => e.accessibleName.trim().length > 0);
  const unnamedSamples = facts.interactive
    .filter((e) => e.accessibleName.trim().length === 0)
    .slice(0, 5)
    .map((e) => `${e.role} @ (${e.boundingBox.x},${e.boundingBox.y}) ${e.boundingBox.width}x${e.boundingBox.height}`);

  // JS-only detection: a rendered text block whose (whitespace-normalized)
  // content is absent from the raw HTTP body only exists post-JS.
  const collapsedRaw = rawHtml.replace(/\s+/g, " ");
  const jsOnlySamples: string[] = [];
  for (const block of facts.textBlocks) {
    const probe = block.text.replace(/\s+/g, " ").slice(0, 80).trim();
    if (probe.length >= 40 && !collapsedRaw.includes(probe)) {
      jsOnlySamples.push(`${block.selector}: "${probe}..."`);
    }
  }

  return {
    title: { present: facts.title.trim().length > 0, value: facts.title },
    metaDescription: {
      present: facts.metaDescription.trim().length > 0,
      value: facts.metaDescription,
    },
    structuredData: {
      present: facts.jsonLdBlocks.length > 0,
      blocks: facts.jsonLdBlocks.length,
      valid: structuredDataValid,
    },
    headings: {
      order: facts.headingOrder,
      h1Count: facts.headingOrder.filter((h) => h === 1).length,
      skips,
    },
    altText: {
      total: facts.images.total,
      withAlt: facts.images.withAlt,
      coverage: facts.images.total === 0 ? 1 : facts.images.withAlt / facts.images.total,
    },
    aria: {
      totalInteractive: facts.interactive.length,
      named: named.length,
      coverage: facts.interactive.length === 0 ? 1 : named.length / facts.interactive.length,
      unnamedSamples,
    },
    jsOnly: {
      detected: rawHtml.length > 0 && jsOnlySamples.length > 0,
      samples: jsOnlySamples.slice(0, 5),
    },
  };
}
