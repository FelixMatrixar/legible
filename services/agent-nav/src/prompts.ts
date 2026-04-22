import type { HistoryEntry } from "@legible/shared";
import type { PerceptionSnapshot } from "./tools";

export const PLANNER_SYSTEM = `You are a navigation agent auditing how legible a web page is to machines.
You are given a goal and the page's interactive elements (role, accessible name, position).
Rules:
- Prefer choosing a target by its ACCESSIBLE NAME. That is the whole point of the audit.
- If the accessible signals are insufficient to decide (missing names, several identical
  generic names like "Click here"), respond status "need-screenshot" — do NOT guess from
  position unless you have been given the screenshot.
- When you have a screenshot and must pick by visual position, use clickAt with pixel coordinates.
- Never repeat an action that already appears in the history with result "no change" or "action failed".
- If the goal is already satisfied by the current page state, respond status "goal-satisfied".
- If every plausible candidate has been tried and failed, respond status "stuck".
- Respond with exactly one action per turn.`;

export const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["act", "goal-satisfied", "stuck", "need-screenshot"] },
    action: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", enum: ["click", "type", "scroll", "clickAt"] },
        ref: { type: "STRING" },
        text: { type: "STRING" },
        direction: { type: "STRING", enum: ["up", "down"] },
        x: { type: "NUMBER" },
        y: { type: "NUMBER" },
      },
    },
    reasoning: { type: "STRING" },
  },
  required: ["status", "reasoning"],
} as const;

export interface PlannerResponse {
  status: "act" | "goal-satisfied" | "stuck" | "need-screenshot";
  action?: {
    type: "click" | "type" | "scroll" | "clickAt";
    ref?: string;
    text?: string;
    direction?: "up" | "down";
    x?: number;
    y?: number;
  };
  reasoning: string;
}

export function planPrompt(
  goal: string,
  perception: PerceptionSnapshot,
  history: HistoryEntry[],
  withScreenshot: boolean
): string {
  const elements = perception.elements
    .slice(0, 120)
    .map(
      (e) =>
        `${e.ref} [${e.role}] "${e.accessibleName || "(no accessible name)"}" @ (${e.boundingBox.x},${e.boundingBox.y}) ${e.boundingBox.width}x${e.boundingBox.height}`
    )
    .join("\n");

  const historyText =
    history.length === 0
      ? "(none yet)"
      : history
          .slice(-6)
          .map((h) => `step ${h.step}: ${h.action} [${h.perceptionMode}] → ${h.result}`)
          .join("\n");

  return `GOAL: ${goal}

CURRENT PAGE: ${perception.url}
TITLE: ${perception.title}

INTERACTIVE ELEMENTS:
${elements || "(none found)"}

HISTORY:
${historyText}

${withScreenshot ? "A screenshot of the current viewport is attached. You may now choose by visual position (clickAt) if accessible names are unusable." : "No screenshot provided. Decide from accessible signals only, or request one with status need-screenshot."}

Decide the single next step.`;
}

export const VERIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    goalSatisfied: { type: "BOOLEAN" },
    rationale: { type: "STRING" },
  },
  required: ["goalSatisfied", "rationale"],
} as const;

export interface VerifyResponse {
  goalSatisfied: boolean;
  rationale: string;
}

export function verifyPrompt(input: {
  goal: string;
  actionTaken: string;
  beforeUrl: string;
  afterUrl: string;
  afterTitle: string;
  stateChanged: boolean;
  visibleTextExcerpt: string;
}): string {
  return `You are verifying whether a navigation goal has ACTUALLY been achieved based on page state — an agent claiming success is not evidence.

GOAL: ${input.goal}
ACTION JUST TAKEN: ${input.actionTaken}
URL BEFORE: ${input.beforeUrl}
URL AFTER: ${input.afterUrl}
PAGE TITLE AFTER: ${input.afterTitle}
DID THE PAGE STATE CHANGE: ${input.stateChanged ? "yes" : "no"}

VISIBLE TEXT AFTER (excerpt):
${input.visibleTextExcerpt}

Judge strictly from this evidence: is the goal satisfied (e.g. a confirmation is visible, the sought content is on screen, the expected navigation happened)?`;
}
