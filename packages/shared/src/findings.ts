import type { Finding, GoalResult, StructureSignals } from "./types";

/**
 * Rule-based finding generation (spec §2.2). Every finding is produced by an
 * explicit threshold against a collected signal — never by asking an LLM to
 * summarize — so each one traces back to a specific number or event.
 */
export function generateFindings(
  signals: StructureSignals | null,
  goalResults: GoalResult[]
): Finding[] {
  const findings: Finding[] = [];
  const hasConversionGoal = goalResults.some((g) => g.primary);

  for (const g of goalResults) {
    if (g.outcome === "failed") {
      findings.push({
        templateId: "AGENT_GOAL_FAILED",
        severity: "critical",
        message: `Agent could not complete '${g.goal}' within the step budget.`,
        evidence: { stepsTaken: g.stepsTaken, history: g.history },
      });
    } else if (g.outcome === "stuck") {
      findings.push({
        templateId: "AGENT_GOAL_STUCK",
        severity: "critical",
        message: `Agent got stuck on '${g.goal}': the same action produced no state change twice in a row.`,
        evidence: { stepsTaken: g.stepsTaken, history: g.history },
      });
    } else if (g.outcome === "error") {
      findings.push({
        templateId: "AGENT_GOAL_ERROR",
        severity: "major",
        message: `Navigation audit for '${g.goal}' errored before completing — result is inconclusive, not a pass.`,
        evidence: { stepsTaken: g.stepsTaken, history: g.history },
      });
    } else if (g.outcome === "succeeded" && g.perceptionModeAtEnd === "visual-fallback") {
      findings.push({
        templateId: g.primary ? "VISUAL_FALLBACK_ON_PRIMARY" : "VISUAL_FALLBACK",
        severity: g.primary ? "major" : "minor",
        message: `'${g.goal}' required visual fallback; no reliable accessible name existed for the target element.`,
        evidence: { stepsTaken: g.stepsTaken, history: g.history },
      });
    }
  }

  if (!signals) return findings;

  if (!signals.title.present) {
    findings.push({
      templateId: "NO_TITLE",
      severity: "minor",
      message: "Page has no <title>.",
    });
  }
  if (!signals.metaDescription.present) {
    findings.push({
      templateId: "NO_META_DESCRIPTION",
      severity: "minor",
      message: "Page has no meta description.",
    });
  }

  if (signals.altText.total > 0 && signals.altText.coverage < 0.8) {
    const missing = signals.altText.total - signals.altText.withAlt;
    findings.push({
      templateId: "ALT_TEXT_LOW",
      severity: "major",
      message: `${missing} of ${signals.altText.total} images have no meaningful alt text.`,
      evidence: { coverage: signals.altText.coverage },
    });
  }

  if (signals.aria.totalInteractive > 0 && signals.aria.coverage < 0.9) {
    const unnamed = signals.aria.totalInteractive - signals.aria.named;
    findings.push({
      templateId: "ARIA_LOW",
      severity: "major",
      message: `${unnamed} interactive elements have no accessible name.`,
      evidence: {
        coverage: signals.aria.coverage,
        samples: signals.aria.unnamedSamples,
      },
    });
  }

  if (!signals.structuredData.present) {
    findings.push({
      templateId: "NO_STRUCTURED_DATA",
      severity: hasConversionGoal ? "major" : "minor",
      message: "No structured data (schema.org/JSON-LD) found on this page.",
    });
  } else if (!signals.structuredData.valid) {
    findings.push({
      templateId: "INVALID_STRUCTURED_DATA",
      severity: "major",
      message: "Structured data present but at least one JSON-LD block fails to parse.",
    });
  }

  if (signals.jsOnly.detected) {
    findings.push({
      templateId: "JS_ONLY_CONTENT",
      severity: "critical",
      message:
        "Primary content is present in the rendered DOM but absent from the raw HTML response — invisible to non-JS consumers.",
      evidence: { samples: signals.jsOnly.samples },
    });
  }

  for (const skip of signals.headings.skips) {
    findings.push({
      templateId: "HEADING_SKIP",
      severity: "minor",
      message: `Heading hierarchy skips from h${skip.from} to h${skip.to}.`,
    });
  }
  if (signals.headings.h1Count !== 1) {
    findings.push({
      templateId: "H1_COUNT",
      severity: "minor",
      message:
        signals.headings.h1Count === 0
          ? "Page has no <h1>."
          : `Page has ${signals.headings.h1Count} <h1> elements; expected exactly one.`,
    });
  }

  return findings;
}
