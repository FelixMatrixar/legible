import type { LiveEvent } from "@legible/shared";
import { UpstashRedis } from "./redis";
import { TOPICS } from "./topics";

/**
 * Live dashboard state: a capped event stream the API tails and pushes over
 * WebSocket, plus a per-batch progress hash.
 */
export class LiveState {
  constructor(private readonly redis = new UpstashRedis()) {}

  async emit(event: Omit<LiveEvent, "at">): Promise<void> {
    const full: LiveEvent = { ...event, at: new Date().toISOString() };
    try {
      await this.redis.cmd(
        "XADD", TOPICS.liveEvents, "MAXLEN", "~", 1000, "*", "payload", JSON.stringify(full)
      );
    } catch (err) {
      // Live updates are best-effort; never fail an audit over them.
      console.error("[live] emit failed:", err);
    }
  }

  private progressKey(batchId: string): string {
    return `batch:${batchId}:progress`;
  }

  async initProgress(batchId: string, totalPages: number): Promise<void> {
    const key = this.progressKey(batchId);
    await this.redis.cmd(
      "HSET", key, "total", totalPages, "structureDone", 0, "agentDone", 0, "scored", 0
    );
    await this.redis.cmd("EXPIRE", key, 60 * 60 * 24 * 7);
  }

  async incrProgress(
    batchId: string,
    field: "structureDone" | "agentDone" | "scored"
  ): Promise<number> {
    return this.redis.cmd<number>("HINCRBY", this.progressKey(batchId), field, 1);
  }

  async getProgress(batchId: string): Promise<Record<string, string>> {
    const flat = await this.redis.cmd<string[] | null>("HGETALL", this.progressKey(batchId));
    const out: Record<string, string> = {};
    if (!flat) return out;
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
  }

  /** SET NX guard so exactly one scorer instance scores a page. */
  async claimScoring(pageId: string): Promise<boolean> {
    const res = await this.redis.cmd<string | null>(
      "SET", `scored:${pageId}`, "1", "NX", "EX", 60 * 60 * 24
    );
    return res === "OK";
  }

  async setJoinPart(pageId: string, part: "agent" | "structure", payload: unknown): Promise<void> {
    const key = `join:${pageId}`;
    await this.redis.cmd("HSET", key, part, JSON.stringify(payload));
    await this.redis.cmd("EXPIRE", key, 60 * 60 * 24);
  }

  async getJoin(pageId: string): Promise<{ agent?: string; structure?: string }> {
    const flat = await this.redis.cmd<string[] | null>("HGETALL", `join:${pageId}`);
    const out: { agent?: string; structure?: string } = {};
    if (!flat) return out;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      if (flat[i] === "agent") out.agent = flat[i + 1];
      if (flat[i] === "structure") out.structure = flat[i + 1];
    }
    return out;
  }

  /** Tail live-events after `lastId`; returns new entries and the new cursor. */
  async tailLive(lastId: string): Promise<{ events: LiveEvent[]; lastId: string }> {
    const entries = await this.redis.cmd<[string, string[]][] | null>(
      "XRANGE", TOPICS.liveEvents, `(${lastId}`, "+", "COUNT", 100
    );
    const events: LiveEvent[] = [];
    let cursor = lastId;
    for (const [id, fields] of entries ?? []) {
      cursor = id;
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === "payload") {
          try {
            events.push(JSON.parse(fields[i + 1]) as LiveEvent);
          } catch {
            /* skip malformed */
          }
        }
      }
    }
    return { events, lastId: cursor };
  }

  /** Current newest id in live-events, used as the initial WS cursor. */
  async latestLiveId(): Promise<string> {
    const last = await this.redis.cmd<[string, string[]][] | null>(
      "XREVRANGE", TOPICS.liveEvents, "+", "-", "COUNT", 1
    );
    return last?.[0]?.[0] ?? "0-0";
  }
}
