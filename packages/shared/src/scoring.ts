import type { Finding, Severity } from "./types";

/** Spec §2.3: start at 100; critical −30, major −10, minor −3; floored at 0. */
const DEDUCTION: Record<Severity, number> = {
  critical: 30,
  major: 10,
  minor: 3,
};

export function scorePage(findings: Finding[]): number {
  const total = findings.reduce((sum, f) => sum + DEDUCTION[f.severity], 0);
  return Math.max(0, 100 - total);
}
