import { GeminiClient } from "@legible/gemini";
import {
  classifyGoal,
  type GoalResult,
  type GoalSpec,
  type PageJob,
  type PerceptionMode,
} from "@legible/shared";
import type { Browser } from "playwright";
import { buildNavGraph, type NavStateType } from "./graph";

const MAX_STEPS = Number(process.env.MAX_NAV_STEPS ?? 8);
const GOAL_TIMEOUT_MS = Number(process.env.NAV_GOAL_TIMEOUT_MS ?? 180_000);

export async function runGoalsForPage(
  browser: Browser,
  gemini: GeminiClient,
  job: PageJob
): Promise<GoalResult[]> {
  const results: GoalResult[] = [];

  for (const spec of job.goals) {
    const classification = classifyGoal(spec);

    // Defense in depth: the API rejects these at submission, but a job
    // replayed from the stream must never mutate production either.
    if (classification === "mutating" && job.environment === "production") {
      results.push({
        goal: spec.goal,
        primary: spec.primary ?? false,
        classification,
        outcome: "skipped",
        stepsTaken: 0,
        perceptionModeAtEnd: "accessible-name",
        history: [],
        skippedReason: "potentially-mutating goal not run against production",
      });
      continue;
    }

    const result = await runSingleGoal(browser, gemini, job.url, spec, classification);
    results.push(result);
  }

  return results;
}

async function runSingleGoal(
  browser: Browser,
  gemini: GeminiClient,
  url: string,
  spec: GoalSpec,
  classification: "read-only" | "mutating"
): Promise<GoalResult> {
  const context = await browser.newContext({
    userAgent: "legible-audit/0.1 (navigation agent)",
    viewport: { width: 1366, height: 900 },
  });

  const base: GoalResult = {
    goal: spec.goal,
    primary: spec.primary ?? false,
    classification,
    outcome: "error",
    stepsTaken: 0,
    perceptionModeAtEnd: "accessible-name",
    history: [],
  };

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const graph = buildNavGraph({ page, gemini, maxSteps: MAX_STEPS });
    const final = await withTimeout(
      graph.invoke({ goal: spec.goal }, { recursionLimit: MAX_STEPS * 4 + 10 }) as Promise<NavStateType>,
      GOAL_TIMEOUT_MS,
      `goal timed out after ${GOAL_TIMEOUT_MS}ms`
    );

    base.outcome =
      final.outcome === "in-progress" || final.outcome === "error" ? "failed" : final.outcome;
    base.stepsTaken = final.stepCount;
    base.history = final.history;
    base.perceptionModeAtEnd = perceptionModeOfWinningStep(final);

    // Build-order step 6: anything that wrote state cleans up after itself,
    // even on staging.
    if (base.outcome === "succeeded" && classification === "mutating" && spec.teardownGoal) {
      try {
        const teardownGraph = buildNavGraph({ page, gemini, maxSteps: MAX_STEPS });
        const teardown = await withTimeout(
          teardownGraph.invoke(
            { goal: spec.teardownGoal },
            { recursionLimit: MAX_STEPS * 4 + 10 }
          ) as Promise<NavStateType>,
          GOAL_TIMEOUT_MS,
          "teardown timed out"
        );
        base.teardownOutcome = teardown.outcome === "succeeded" ? "succeeded" : "failed";
      } catch {
        base.teardownOutcome = "error";
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    base.outcome = /recursion/i.test(message) ? "failed" : "error";
    base.history = [
      ...base.history,
      {
        step: base.history.length + 1,
        action: "(run aborted)",
        perceptionMode: "accessible-name",
        result: message.split("\n")[0],
      },
    ];
  } finally {
    await context.close().catch(() => {});
  }

  return base;
}

/** The mode of the winning action (or of the final attempt on failure). */
function perceptionModeOfWinningStep(state: NavStateType): PerceptionMode {
  const last = state.history[state.history.length - 1];
  return last?.perceptionMode ?? "accessible-name";
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
