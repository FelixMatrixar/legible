/**
 * Dependency-free sanity run of the pure logic: goal classification, finding
 * generation, scoring, and JS-only detection.
 * Run with: npm run selfcheck
 */
import { classifyGoal } from "../packages/shared/src/classify";
import { generateFindings } from "../packages/shared/src/findings";
import { scorePage } from "../packages/shared/src/scoring";
import type { GoalResult, StructureSignals } from "../packages/shared/src/types";
import { buildSignals } from "../services/structure-audit/src/audit";
import type { PageFacts } from "../packages/shared/src/extract";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

// ── 1. Goal classification ────────────────────────────────────────────────
{
  check("'locate the pricing' is read-only", classifyGoal({ goal: "locate the pricing" }) === "read-only");
  check("'find the contact page' is read-only", classifyGoal({ goal: "find the contact page" }) === "read-only");
  check("'complete the contact form' is mutating", classifyGoal({ goal: "complete the contact form" }) === "mutating");
  check(
    "'find the checkout and complete the purchase' is mutating (mutating wins ties)",
    classifyGoal({ goal: "find the checkout and complete the purchase" }) === "mutating"
  );
  check("unclassifiable goal defaults to mutating", classifyGoal({ goal: "do the thing" }) === "mutating");
  check(
    "explicit override is honored",
    classifyGoal({ goal: "submit search", classificationOverride: "read-only" }) === "read-only"
  );
}

// ── 3. Scoring: 100 − (critical 30 + major 10 + minor 3), floored at 0 ────
{
  const score = scorePage([
    { templateId: "A", severity: "critical", message: "" },
    { templateId: "B", severity: "major", message: "" },
    { templateId: "C", severity: "minor", message: "" },
  ]);
  check("critical+major+minor scores 57", score === 57, score);
  const floored = scorePage(
    Array.from({ length: 10 }, () => ({ templateId: "X", severity: "critical" as const, message: "" }))
  );
  check("score floors at 0", floored === 0, floored);
}

// ── 4. Finding generation from thresholds ─────────────────────────────────
{
  const signals: StructureSignals = {
    title: { present: true, value: "T" },
    metaDescription: { present: false, value: "" },
    structuredData: { present: false, blocks: 0, valid: false },
    headings: { order: [1, 3], h1Count: 1, skips: [{ from: 1, to: 3 }] },
    altText: { total: 10, withAlt: 4, coverage: 0.4 },
    aria: { totalInteractive: 20, named: 15, coverage: 0.75, unnamedSamples: [] },
    jsOnly: { detected: true, samples: ["main > p: \"pricing...\""] },
  };
  const goals: GoalResult[] = [
    {
      goal: "find and click the primary call-to-action",
      primary: true,
      classification: "read-only",
      outcome: "succeeded",
      stepsTaken: 3,
      perceptionModeAtEnd: "visual-fallback",
      history: [],
    },
    {
      goal: "complete the signup",
      primary: false,
      classification: "mutating",
      outcome: "failed",
      stepsTaken: 8,
      perceptionModeAtEnd: "accessible-name",
      history: [],
    },
  ];
  const findings = generateFindings(signals, goals);
  const ids = findings.map((f) => f.templateId);
  for (const expected of [
    "VISUAL_FALLBACK_ON_PRIMARY",
    "AGENT_GOAL_FAILED",
    "NO_META_DESCRIPTION",
    "NO_STRUCTURED_DATA",
    "ALT_TEXT_LOW",
    "ARIA_LOW",
    "JS_ONLY_CONTENT",
    "HEADING_SKIP",
  ]) {
    check(`emits ${expected}`, ids.includes(expected), ids);
  }
  check(
    "visual fallback on primary goal is major",
    findings.find((f) => f.templateId === "VISUAL_FALLBACK_ON_PRIMARY")?.severity === "major"
  );
  check(
    "structured data absent is major when a conversion goal exists",
    findings.find((f) => f.templateId === "NO_STRUCTURED_DATA")?.severity === "major"
  );
}

// ── 5. JS-only diff: rendered text absent from raw HTML is flagged ────────
{
  const facts: PageFacts = {
    url: "https://x.test/",
    title: "X",
    metaDescription: "d",
    jsonLdBlocks: ["{\"@type\":\"Product\"}"],
    headingOrder: [1, 2],
    images: { total: 2, withAlt: 2 },
    interactive: [
      { ref: "e1", role: "button", accessibleName: "Buy now", boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
    ],
    textBlocks: [
      { selector: "main > p", text: "This paragraph exists in the raw HTML response body and is fine." },
      { selector: "main > div > p", text: "This pricing table only renders client-side after JavaScript runs today." },
    ],
  };
  const raw = "<html><body><p>This paragraph exists in the raw HTML response body and is fine.</p></body></html>";
  const signals = buildSignals(facts, raw);
  check("JS-only content detected", signals.jsOnly.detected, signals.jsOnly);
  check("only the client-side block is flagged", signals.jsOnly.samples.length === 1, signals.jsOnly.samples);
  check("no heading skip for 1→2", signals.headings.skips.length === 0);
  check("aria coverage is 1 for fully named elements", signals.aria.coverage === 1);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll selfchecks passed.");
