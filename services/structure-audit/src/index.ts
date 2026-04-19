import "dotenv/config";
import { createBus, GROUPS, LiveState, TOPICS } from "@legible/bus";
import { saveStructureResult } from "@legible/db";
import type { PageJob, StructureResultEvent } from "@legible/shared";
import { hostname } from "node:os";
import { chromium, type Browser } from "playwright";
import { auditStructure } from "./audit";

const bus = createBus();
const live = new LiveState();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // --disable-dev-shm-usage avoids renderer crashes on the small default
    // /dev/shm (Docker's 64MB default is too small for Chromium); --no-sandbox
    // is needed on PaaS containers (Render, Heroku, etc.) that don't expose
    // the unprivileged user-namespace Chromium's sandbox otherwise requires.
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
  }
  return browser;
}

async function handleJob(job: PageJob): Promise<void> {
  console.log(`[structure] auditing ${job.url}`);
  const result: StructureResultEvent = {
    batchId: job.batchId,
    pageId: job.pageId,
    url: job.url,
    signals: null,
  };

  try {
    result.signals = await auditStructure(await getBrowser(), job.url);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[structure] audit failed for ${job.url}:`, err);
  }

  await saveStructureResult(job.pageId, result.signals, result.error);
  await bus.publish(TOPICS.structureResults, result);
  await live.incrProgress(job.batchId, "structureDone");
  await live.emit({
    type: "structure-done",
    batchId: job.batchId,
    pageId: job.pageId,
    url: job.url,
    detail: result.error ? `error: ${result.error}` : undefined,
  });
}

const consumer = `${hostname()}-${process.pid}`;
bus
  .consume<PageJob>(TOPICS.pagesToAudit, GROUPS.structureAudit, consumer, handleJob)
  .catch((err) => {
    console.error("[structure] consumer crashed:", err);
    process.exit(1);
  });
