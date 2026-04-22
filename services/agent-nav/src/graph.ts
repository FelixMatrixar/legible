import type { GeminiClient } from "@legible/gemini";
import type { HistoryEntry, PerceptionMode } from "@legible/shared";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Page } from "playwright";
import {
  PLAN_SCHEMA,
  PLANNER_SYSTEM,
  planPrompt,
  VERIFY_SCHEMA,
  verifyPrompt,
  type PlannerResponse,
  type VerifyResponse,
} from "./prompts";
import {
  captureScreenshot,
  describeAction,
  executeAction,
  fingerprint,
  getVisibleText,
  listInteractiveElements,
  type NavAction,
  type PerceptionSnapshot,
} from "./tools";

export type NavOutcome = "in-progress" | "succeeded" | "failed" | "stuck" | "error";

/** Spec §1.2 — everything the graph needs, threaded through every node. */
const NavState = Annotation.Root({
  goal: Annotation<string>,
  stepCount: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  history: Annotation<HistoryEntry[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  perception: Annotation<PerceptionSnapshot | null>({ reducer: (_a, b) => b, default: () => null }),
  /** Perception mode of the step currently being planned/acted. */
  stepPerceptionMode: Annotation<PerceptionMode>({
    reducer: (_a, b) => b,
    default: () => "accessible-name" as PerceptionMode,
  }),
  planned: Annotation<PlannerResponse | null>({ reducer: (_a, b) => b, default: () => null }),
  preFingerprint: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  preUrl: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  outcome: Annotation<NavOutcome>({
    reducer: (_a, b) => b,
    default: () => "in-progress" as NavOutcome,
  }),
  failureReason: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
});

export type NavStateType = typeof NavState.State;

export interface NavGraphDeps {
  page: Page;
  gemini: GeminiClient;
  maxSteps: number;
}

export function buildNavGraph(deps: NavGraphDeps) {
  const { page, gemini, maxSteps } = deps;

  const perceive = async (): Promise<Partial<NavStateType>> => {
    const snapshot = await listInteractiveElements(page);
    return { perception: snapshot };
  };

  const plan = async (state: NavStateType): Promise<Partial<NavStateType>> => {
    if (state.stepCount >= maxSteps) {
      return {
        outcome: "failed",
        failureReason: `step budget (${maxSteps}) exhausted`,
        planned: null,
      };
    }
    const perception = state.perception ?? (await listInteractiveElements(page));

    // Attempt 1: accessibility-tree signals only. The screenshot is never
    // captured up front — falling back to it is itself the finding.
    let response = await gemini.generateJson<PlannerResponse>({
      system: PLANNER_SYSTEM,
      prompt: planPrompt(state.goal, perception, state.history, false),
      schema: PLAN_SCHEMA,
    });
    let mode: PerceptionMode = "accessible-name";

    if (response.status === "need-screenshot") {
      const screenshot = await captureScreenshot(page);
      response = await gemini.generateJson<PlannerResponse>({
        system: PLANNER_SYSTEM,
        prompt: planPrompt(state.goal, perception, state.history, true),
        imageBase64Png: screenshot,
        schema: PLAN_SCHEMA,
      });
      mode = "visual-fallback";
    }

    if (response.status === "stuck") {
      return {
        outcome: "stuck",
        failureReason: `planner declared stuck: ${response.reasoning}`,
        planned: response,
        stepPerceptionMode: mode,
      };
    }
    return { planned: response, stepPerceptionMode: mode, perception };
  };

  const act = async (state: NavStateType): Promise<Partial<NavStateType>> => {
    const action = state.planned?.action as NavAction | undefined;
    const preFp = await fingerprint(page);
    const preUrl = page.url();
    if (!action) return { preFingerprint: preFp, preUrl };
    try {
      await executeAction(page, action);
      return { preFingerprint: preFp, preUrl };
    } catch (err) {
      const entry: HistoryEntry = {
        step: state.stepCount + 1,
        action: describeAction(action, state.perception ?? undefined),
        perceptionMode: state.stepPerceptionMode,
        result: `action failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
      };
      return {
        preFingerprint: preFp,
        preUrl,
        history: [entry],
        stepCount: state.stepCount + 1,
      };
    }
  };

  const verify = async (state: NavStateType): Promise<Partial<NavStateType>> => {
    // If Act already recorded a failed-action entry, skip verification.
    const lastEntry = state.history[state.history.length - 1];
    if (lastEntry && lastEntry.step === state.stepCount && lastEntry.result.startsWith("action failed")) {
      return {};
    }

    const action = state.planned?.action as NavAction | undefined;
    const claimedSatisfied = state.planned?.status === "goal-satisfied";
    const postFp = await fingerprint(page);
    const stateChanged = state.preFingerprint !== null && postFp !== state.preFingerprint;
    const actionLabel = claimedSatisfied
      ? "(none — agent claims goal already satisfied)"
      : describeAction(action ?? null, state.perception ?? undefined);

    let goalSatisfied = false;
    let result: string;

    if (!stateChanged && !claimedSatisfied) {
      result = "no change";
    } else {
      const visibleText = (await getVisibleText(page)).slice(0, 1500);
      const check = await gemini.generateJson<VerifyResponse>({
        prompt: verifyPrompt({
          goal: state.goal,
          actionTaken: actionLabel,
          beforeUrl: state.preUrl || page.url(),
          afterUrl: page.url(),
          afterTitle: await page.title().catch(() => ""),
          stateChanged,
          visibleTextExcerpt: visibleText,
        }),
        schema: VERIFY_SCHEMA,
      });
      goalSatisfied = check.goalSatisfied;
      result = goalSatisfied
        ? "goal confirmed"
        : stateChanged
          ? "state changed, goal not yet satisfied"
          : "claim rejected: page state does not show the goal satisfied";
    }

    const step = state.stepCount + 1;
    const entry: HistoryEntry = {
      step,
      action: actionLabel,
      perceptionMode: state.stepPerceptionMode,
      result,
    };

    // Stuck-detection (§1.4): same action, no state change, twice in a row.
    const prev = state.history[state.history.length - 1];
    const isStuck =
      !goalSatisfied &&
      result === "no change" &&
      prev !== undefined &&
      prev.action === entry.action &&
      prev.result === "no change";

    const outcome: NavOutcome = goalSatisfied
      ? "succeeded"
      : isStuck
        ? "stuck"
        : step >= maxSteps
          ? "failed"
          : "in-progress";

    return {
      history: [entry],
      stepCount: step,
      outcome,
      ...(outcome === "failed" ? { failureReason: `step budget (${maxSteps}) exhausted` } : {}),
      ...(outcome === "stuck"
        ? { failureReason: "same action produced no state change twice in a row" }
        : {}),
    };
  };

  const routeAfterPlan = (state: NavStateType): "act" | "verify" | "done" => {
    if (state.outcome === "failed" || state.outcome === "stuck") return "done";
    if (state.planned?.status === "goal-satisfied") return "verify";
    return "act";
  };

  const routeAfterVerify = (state: NavStateType): "continue" | "replan" | "done" => {
    if (state.outcome !== "in-progress") return "done";
    const last = state.history[state.history.length - 1];
    // No state change → the perception is still valid; retry planning with a
    // different candidate instead of re-perceiving.
    if (last && (last.result === "no change" || last.result.startsWith("action failed"))) {
      return "replan";
    }
    return "continue";
  };

  return new StateGraph(NavState)
    .addNode("perceive", perceive)
    .addNode("plan", plan)
    .addNode("act", act)
    .addNode("verify", verify)
    .addEdge(START, "perceive")
    .addEdge("perceive", "plan")
    .addConditionalEdges("plan", routeAfterPlan, { act: "act", verify: "verify", done: END })
    .addEdge("act", "verify")
    .addConditionalEdges("verify", routeAfterVerify, {
      continue: "perceive",
      replan: "plan",
      done: END,
    })
    .compile();
}
