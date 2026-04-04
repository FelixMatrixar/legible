import { LiveState, TOPICS, type Bus } from "@legible/bus";
import { createBatch, getBatch, getPageReport, listBatches } from "@legible/db";
import { classifyGoal, type PageJob } from "@legible/shared";
import { Router } from "express";
import { z } from "zod";
import { requireCaller } from "./auth";
import { rateLimit } from "./rateLimit";

const goalSchema = z.object({
  goal: z.string().min(3),
  primary: z.boolean().optional(),
  classificationOverride: z.enum(["read-only", "mutating"]).optional(),
  teardownGoal: z.string().optional(),
});

const submitSchema = z.object({
  name: z.string().min(1),
  environment: z.enum(["staging", "production"]).default("staging"),
  webhookUrl: z.string().url().optional(),
  pages: z
    .array(
      z.object({
        url: z.string().url(),
        goals: z.array(goalSchema).default([]),
      })
    )
    .min(1)
    .max(500),
});

export function buildRoutes(bus: Bus, live: LiveState): Router {
  const router = Router();

  router.post("/batches", rateLimit(), requireCaller, async (req, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid batch", details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;

    // Safety gate (build-order step 4): a goal classified as potentially
    // mutating must never target production. Rejected at submission, not
    // silently skipped at run time, so the operator finds out immediately.
    if (input.environment === "production") {
      const violations = input.pages.flatMap((p) =>
        p.goals
          .filter((g) => classifyGoal(g) === "mutating")
          .map((g) => ({ url: p.url, goal: g.goal }))
      );
      if (violations.length > 0) {
        res.status(400).json({
          error:
            "Batch targets production but contains potentially-mutating goals. " +
            "Point these at staging, or mark them classificationOverride:'read-only' only if you are certain.",
          violations,
        });
        return;
      }
    }

    try {
      const created = await createBatch({
        name: input.name,
        environment: input.environment,
        webhookUrl: input.webhookUrl,
        createdBy: String(res.locals.callerId),
        pages: input.pages,
      });

      await live.initProgress(created.batchId, created.pages.length);
      await live.emit({ type: "batch-submitted", batchId: created.batchId, detail: input.name });

      for (const page of created.pages) {
        const job: PageJob = {
          batchId: created.batchId,
          pageId: page.pageId,
          url: page.url,
          environment: input.environment,
          goals: page.goals,
        };
        await bus.publish(TOPICS.pagesToAudit, job);
        await live.emit({
          type: "page-queued",
          batchId: created.batchId,
          pageId: page.pageId,
          url: page.url,
        });
      }

      res.status(201).json({
        batchId: created.batchId,
        pages: created.pages.map((p) => ({
          pageId: p.pageId,
          url: p.url,
          goals: p.goals.map((g) => ({ goal: g.goal, classification: classifyGoal(g) })),
        })),
      });
    } catch (err) {
      console.error("[api] submit failed:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "submit failed" });
    }
  });

  router.get("/batches", requireCaller, async (_req, res) => {
    try {
      res.json({ batches: await listBatches() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
    }
  });

  router.get("/batches/:id", requireCaller, async (req, res) => {
    try {
      const data = await getBatch(req.params.id);
      const progress = await live.getProgress(req.params.id);
      res.json({ ...data, progress });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "not found" });
    }
  });

  router.get("/pages/:id", requireCaller, async (req, res) => {
    try {
      res.json(await getPageReport(req.params.id));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "not found" });
    }
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}
