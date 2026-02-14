import type { GoalClassification, GoalSpec } from "./types";

/**
 * Read-only vs potentially-mutating goal classification.
 *
 * Mutating patterns are checked FIRST and win ties ("find the checkout and
 * complete the purchase" is mutating). Anything matching neither list is
 * treated as mutating — the safe default: an unclassifiable goal must not
 * run unattended against production.
 */
const MUTATING_PATTERNS: RegExp[] = [
  /\bsubmit\b/, /\bcomplete\b/, /\bcheckout\b/, /\bcheck\s*out\b/, /\bpurchase\b/,
  /\bbuy\b/, /\border\b/, /\bsign\s*up\b/, /\bregister\b/, /\bcreate\b/,
  /\badd\b/, /\bsend\b/, /\bpost\b/, /\bdelete\b/, /\bremove\b/, /\bupdate\b/,
  /\bsubscribe\b/, /\bunsubscribe\b/, /\bfill\b/, /\bupload\b/, /\bpay\b/,
  /\bbook\b/, /\bapply\b/, /\blog\s*in\b/, /\bsign\s*in\b/, /\bcancel\b/,
];

const READ_ONLY_PATTERNS: RegExp[] = [
  /\bfind\b/, /\blocate\b/, /\bread\b/, /\bidentify\b/, /\bwhere\b/,
  /\blook\s+for\b/, /\bnavigate\s+to\b/, /\bgo\s+to\b/, /\bview\b/, /\bopen\b/,
];

export function classifyGoal(spec: GoalSpec): GoalClassification {
  if (spec.classificationOverride) return spec.classificationOverride;
  const g = spec.goal.toLowerCase();
  if (MUTATING_PATTERNS.some((p) => p.test(g))) return "mutating";
  if (READ_ONLY_PATTERNS.some((p) => p.test(g))) return "read-only";
  return "mutating";
}
