/**
 * All-in-one entrypoint: API + all three workers in a single process.
 *
 * Exists for single-instance deployments — Render's free tier only gives
 * free compute to Web Services (background workers are paid), and the free
 * hours pool covers exactly one always-on service. Each service module
 * starts itself on import; they already coexist (separate Kafka consumer
 * groups, one shared HTTP port from the API).
 *
 * Trade-off vs the split deploy (render.scaled.yaml): everything shares one
 * 512MB instance — fine for small batches, but structure-audit and
 * agent-nav each run a headless Chromium, so big pages can OOM. Upgrade
 * path is the split blueprint, not more code.
 */
import "dotenv/config";
import "../../api/src/index";
import "../../structure-audit/src/index";
import "../../agent-nav/src/index";
import "../../scorer/src/index";

console.log("[all] api + structure-audit + agent-nav + scorer running in one process");
