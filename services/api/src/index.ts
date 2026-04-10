import "dotenv/config";
import { createBus, LiveState } from "@legible/bus";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { buildRoutes } from "./routes";
import { attachLiveSocket } from "./ws";

const app = express();

// The dashboard is deployed as a separate static site (different origin from
// the API), so it needs an explicit CORS allowlist. DASHBOARD_ORIGIN takes a
// comma-separated list; unset means same-origin/local-dev only.
const allowedOrigins = (process.env.DASHBOARD_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length === 0 ? false : allowedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

const bus = createBus();
const live = new LiveState();

app.use("/api", buildRoutes(bus, live));

const server = createServer(app);
attachLiveSocket(server, live);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});
