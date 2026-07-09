import { classifyGoal as heuristicClassify, type GoalClassification } from "@legible/shared";
import type { LlmClient } from "./client";

const SCHEMA = {
  type: "object",
  properties: {
    classification: { type: "string", enum: ["read-only", "mutating"] },
    reason: { type: "string" },
  },
  required: ["classification", "reason"],
} as const;

const SYSTEM =
  "You classify a web-navigation goal for a safety gate. Answer 'mutating' if " +
  "achieving the goal could change server-side state — submitting a form, creating " +
  "or deleting an account, placing/canceling an order, sending a message, uploading, " +
  "paying, subscribing, posting. Answer 'read-only' if it is purely navigational or " +
  "informational — finding, locating, reading, or viewing something. When genuinely " +
  "uncertain, answer 'mutating' (the safe default).";

/**
 * LLM-based read-only vs mutating classification — understands intent instead
 * of matching keywords. Falls back to the heuristic classifier if the LLM
 * call fails, so the safety gate never depends on the model being reachable.
 */
export async function classifyGoalWithAI(llm: LlmClient, goal: string): Promise<GoalClassification> {
  try {
    const res = await llm.generateJson<{ classification: GoalClassification }>({
      system: SYSTEM,
      prompt: `Goal: "${goal}"`,
      schema: SCHEMA,
      temperature: 0,
    });
    return res.classification === "read-only" ? "read-only" : "mutating";
  } catch (err) {
    console.error(`[classify] LLM classify failed for "${goal}", using heuristic:`, err);
    return heuristicClassify({ goal });
  }
}
