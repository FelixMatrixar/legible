import type { LiveState } from "@legible/bus";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

/**
 * Tails the live-events stream (REST polling — no persistent Redis
 * connection) and fans new events out to every connected dashboard.
 */
export function attachLiveSocket(server: Server, live: LiveState): void {
  const wss = new WebSocketServer({ server, path: "/ws" });
  let cursor: string | null = null;

  wss.on("connection", (socket, req) => {
    // Same single-operator key as the REST routes, passed as ?key= since
    // browsers can't set headers on WebSocket connects.
    const expected = process.env.INTERNAL_API_KEY;
    const provided = new URL(req.url ?? "", "http://x").searchParams.get("key");
    if (expected && provided !== expected) {
      socket.close(4401, "unauthorized");
      return;
    }
    socket.send(JSON.stringify({ type: "hello", at: new Date().toISOString() }));
  });

  const tick = async () => {
    try {
      if (wss.clients.size === 0) return;
      if (cursor === null) cursor = await live.latestLiveId();
      const { events, lastId } = await live.tailLive(cursor);
      cursor = lastId;
      if (events.length === 0) return;
      const frame = JSON.stringify({ type: "live-events", events });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(frame);
      }
    } catch (err) {
      console.error("[ws] tail error:", err);
    }
  };

  const interval = setInterval(tick, Number(process.env.WS_TAIL_MS ?? 2000));
  wss.on("close", () => clearInterval(interval));
}
