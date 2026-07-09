# legible — an AI-legibility auditor for websites

Given a batch of URLs, legible runs two independent audits per page — a
goal-directed **navigation audit** (an LLM agent tries to actually use the page,
and *how* it had to perceive the target is the finding) and a **structural
audit** (meta/structured data, heading hierarchy, alt text, ARIA coverage, and
JS-only content detection) — then combines them into a per-page legibility
score with rule-generated, evidence-backed findings.

## Architecture

```
POST /api/batches (X-API-Key)
        │
        ▼
  pages-to-audit          ── Upstash Redis Stream, consumer groups
    ┌───┴────┐
    ▼        ▼
[agent-nav]  [structure-audit]      run independently, in parallel
    │        │
agent-results  structure-results    ── streams
    └──────┬──────┘
           ▼
        [scorer]          ── joins both signals per page, scores, persists
           │
   Upstash Redis (results + live state) → API WebSocket → dashboard
           │
   webhook (Slack/Discord) on batch completion
```

> **Event backbone:** real **Apache Kafka** by default (`kafkajs` driver in
> `packages/bus/src/kafka.ts`) — the spec's original pick, Upstash Kafka, was
> sunset by Upstash, so bring any Kafka: local Redpanda via `docker compose up
> redpanda`, Redpanda Serverless, or Confluent Cloud. Consumer groups are
> namespaced `<group>.<topic>`, new groups replay from the beginning, failed
> messages retry 5× then land in `<topic>-dlq`, and long-running audits send
> manual heartbeats so the group never rebalances mid-navigation. Setting
> `BUS_DRIVER=redis` swaps to an Upstash **Redis Streams** driver with
> identical semantics (consumer groups, `XAUTOCLAIM` crash recovery, DLQ,
> replay) if you ever want one fewer moving part — services only ever see the
> `Bus` interface. Redis stays in the stack either way for live dashboard
> state, the scorer's join, and progress counters.

## Layout

| Path | What it is |
|---|---|
| `packages/shared` | Types, read-only/mutating goal classifier, rule-based finding engine (§2.2), scoring (§2.3), in-browser extraction shared by both workers |
| `packages/llm` | OpenRouter chat client (OpenAI-compatible) for the navigation agent — one key, model set via `OPENROUTER_MODEL` |
| `packages/bus` | Event bus behind one `Bus` interface — Apache Kafka driver (default) + Upstash Redis Streams driver — plus live dashboard state |
| `packages/db` | Redis-backed result store: batches, scores, findings, per-URL score history — the spec's "lookup by batch/page id" scope, no SQL needed |
| `services/api` | Express, single-operator X-API-Key auth. Batch submission (with the mutating-goal production gate), reports, WebSocket live tail |
| `services/structure-audit` | Playwright render vs raw HTTP body diff → structural signals |
| `services/agent-nav` | LangGraph.js Perceive → Plan → Act → Verify loop; screenshot only on accessible-signal ambiguity (`visual-fallback` is recorded and *is* the finding); stuck-detection; teardown goals |
| `services/scorer` | Joins both results per page, generates findings, scores, batch rollup, completion webhook |
| `apps/dashboard` | React + React Flow (live pipeline) + Zustand + Tailwind + WebSocket |

## Setup

1. **Install** (Node 22+):
   ```sh
   npm install
   npx playwright install chromium   # local browser for the workers
   ```
2. **Env**: copy `.env.example` → `.env` and fill it in. `OPENROUTER_API_KEY`
   drives the navigation agent; `OPENROUTER_MODEL` picks the model (default is
   a vision-capable Gemini model so the screenshot fallback works).
   `INTERNAL_API_KEY` is the single-operator key: any long random string —
   the dashboard asks for it once and keeps it in localStorage.

## Run

```sh
npm run api               # :8080 — REST + WebSocket
npm run worker:structure
npm run worker:agent
npm run worker:scorer
npm run dashboard         # :5173, proxies /api and /ws to :8080
```

Submit a batch:

```sh
curl -X POST http://localhost:8080/api/batches \
  -H "Content-Type: application/json" -H "X-API-Key: $INTERNAL_API_KEY" \
  -d '{
    "name": "first audit",
    "environment": "staging",
    "pages": [{
      "url": "https://staging.example.com/",
      "goals": [
        {"goal": "find and click the primary call-to-action", "primary": true},
        {"goal": "locate the pricing"}
      ]
    }]
  }'
```

## Rate limits

All tunable in `.env`:

| Knob | Default | Why |
|---|---|---|
| `BUS_POLL_MS` | `5000` | Idle stream polling costs Upstash commands 24/7. 5s + occasional-only `XAUTOCLAIM` ≈ ~75K commands/day idle vs ~300K at the old 1.5s — at $0.2/100K that's the difference between ~$4.5 and ~$19/month of pure idle spend. |
| `WS_TAIL_MS` | `2000` | Dashboard live-tail poll; only runs while a client is connected. |
| `SUBMIT_RATE_LIMIT_PER_MIN` | `30` | Sliding-window cap per caller on `POST /api/batches`. Batch size is separately capped at 500 pages. |

Capacity math for sizing batches: a navigation goal costs at most `2 × MAX_NAV_STEPS + 1`
OpenRouter calls (plan + optional screenshot re-plan + verify per step) ≈ 17 worst
case, ~6–8 typical — so mind your OpenRouter credit/rate limits on large batches.
Page crawling is polite by construction: each worker processes pages sequentially, so
site concurrency equals the number of worker replicas (2 with the default compose file).

## Safety model

- Every goal is classified **read-only vs potentially-mutating** before it
  runs (`packages/shared/src/classify.ts`). Unclassifiable goals default to
  mutating.
- A batch targeting `production` that contains any mutating goal is **rejected
  at submission** (HTTP 400) — and agent-nav re-checks at run time, so a
  replayed stream event can't mutate production either.
- Mutating goals may carry a `teardownGoal` that runs after success to clean
  up whatever was written, even on staging.

## Validate

```sh
npm run typecheck             # backend + workers
npm run typecheck:dashboard
npm run selfcheck             # key rotation, classifier, findings, scoring, JS-only diff
```

## Deploy

### Option A — Docker Compose on any VPS

```sh
docker compose up --build     # api + three workers; browsers baked into the worker image
```

Serve `apps/dashboard` (after `npm run build`) from anywhere static — the
same host via nginx, or a separate static host. Point it at any persistent
host (VPS / Railway / Fly.io).

### Option B — Render (free tier)

`render.yaml` is a Blueprint for the **free-tier layout**: one Web Service
(`legible`) running the API and all three workers in a single process via
`services/all` — Render only gives free compute to Web Services (background
workers are paid), and the ~750 free instance-hours/month cover exactly one
always-on service — plus `legible-dashboard` (free Static Site). Two things
keep this workable: `.github/workflows/keepalive.yml` pings `/api/health`
every 10 minutes so the free instance never sleeps mid-batch, and both
Chromium-using stages share the one 512MB instance — keep batches small.
When you outgrow it (Chromium OOM restarts in the logs), switch to
`render.scaled.yaml` (rename it to `render.yaml`): separate paid Starter
workers with the same env layout.

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo. Render reads `render.yaml`
   and proposes all five services.
3. After the first deploy, fill in the secrets Render left blank (marked
   `sync: false` in the blueprint): `OPENROUTER_API_KEY`,
   `KAFKA_BROKERS`/`_USERNAME`/`_PASSWORD` (Render can't host a broker —
   create a free [Redpanda Serverless](https://redpanda.com) cluster or a
   Confluent Cloud basic cluster and paste its bootstrap URL + SASL creds),
   `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `INTERNAL_API_KEY`, `WEBHOOK_URL`,
   and on the dashboard `VITE_API_URL` (the API's Render URL — redeploy the
   dashboard after setting it, Vite bakes it in at build time).
4. On `legible-api`, add `DASHBOARD_ORIGIN` = the dashboard's Render URL
   (e.g. `https://legible-dashboard.onrender.com`) — required for CORS, since
   the dashboard and API are separate origins on Render.
5. On `legible-dashboard`, add `VITE_API_URL` = the API's Render URL (no
   trailing slash) — Vite bakes this in at build time, so redeploy the
   dashboard after setting it.

**Two free-tier caveats, in order of how much they matter:**

- **RAM.** Free instances are small (check Render's current spec — it's been
  512MB), and headless Chromium is not light. `structure-audit` and
  `agent-nav` are the ones actually worth upgrading to a paid Starter
  instance first if you see OOM restarts in their logs; `legible-scorer`
  never launches a browser and is cheap to leave on free.
- **Shared free instance-hours.** Render pools free-tier hours across your
  account; five always-on services (four compute + the free static site,
  which doesn't count) can exceed that pool before a full month is up,
  which suspends whichever services tip it over. Watch usage in the Render
  dashboard after the first week; the static dashboard is unaffected either
  way, since static sites aren't billed as compute instances.

Both `chromium.launch()` calls already pass `--disable-dev-shm-usage
--no-sandbox` — required on Render-like containers that don't expose the
sandboxing Chromium normally wants, independent of the RAM question above.

### Recurring audits

Add `LEGIBLE_API_URL` + `LEGIBLE_API_KEY` repo secrets and edit
`audit-targets.json` — `.github/workflows/scheduled-audit.yml` submits it daily
and on demand.
