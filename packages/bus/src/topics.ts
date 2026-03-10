/** Stream keys — same names as the topics in the architecture diagram. */
export const TOPICS = {
  pagesToAudit: "pages-to-audit",
  agentResults: "agent-results",
  structureResults: "structure-results",
  liveEvents: "live-events",
} as const;

export const GROUPS = {
  structureAudit: "structure-audit",
  agentNav: "agent-nav",
  scorer: "scorer",
} as const;
