import type { Bus, ConsumeOptions, Handler } from "./contract";
import { UpstashRedis } from "./redis";

/**
 * Upstash Redis Streams driver — the fallback when no Kafka broker is
 * configured (see factory.ts; the Apache Kafka driver lives in kafka.ts).
 *
 * Kafka-shaped semantics, deliberately: independent consumer groups read the
 * same stream (structure-audit and agent-nav both consume pages-to-audit
 * without coordinating), unacked messages from a crashed consumer are
 * reclaimed via XAUTOCLAIM, and groups created with id "0" replay the full
 * retained history — so a new analysis dimension added later can be replayed
 * against past page events without re-crawling.
 */

const MAXLEN = 10_000;
const MAX_DELIVERIES = 5;
const AUTOCLAIM_IDLE_MS = 60_000;

type StreamEntry = [id: string, fields: string[]];
type XReadGroupResult = [stream: string, entries: StreamEntry[]][] | null;

export class EventBus implements Bus {
  constructor(private readonly redis = new UpstashRedis()) {}

  async publish(topic: string, payload: unknown): Promise<string> {
    return this.redis.cmd<string>(
      "XADD", topic, "MAXLEN", "~", MAXLEN, "*", "payload", JSON.stringify(payload)
    );
  }

  /** id "0" = replay retained history for a brand-new group. */
  async ensureGroup(topic: string, group: string): Promise<void> {
    try {
      await this.redis.cmd("XGROUP", "CREATE", topic, group, "0", "MKSTREAM");
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("BUSYGROUP"))) throw err;
    }
  }

  /**
   * Poll loop: new messages first, then reclaim messages a crashed consumer
   * left pending. A handler failure leaves the message unacked for retry;
   * after MAX_DELIVERIES it is dead-lettered to `<topic>-dlq` and acked.
   */
  async consume<T>(
    topic: string,
    group: string,
    consumer: string,
    handler: Handler<T>,
    opts: ConsumeOptions = {}
  ): Promise<void> {
    const { pollMs = Number(process.env.BUS_POLL_MS ?? 5000), batchSize = 5, signal } = opts;
    await this.ensureGroup(topic, group);
    console.log(`[bus] consuming ${topic} as ${group}/${consumer} (poll ${pollMs}ms)`);

    let idlePolls = 0;
    while (!signal?.aborted) {
      let entries: StreamEntry[] = [];
      try {
        const fresh = await this.redis.cmd<XReadGroupResult>(
          "XREADGROUP", "GROUP", group, consumer,
          "COUNT", batchSize, "STREAMS", topic, ">"
        );
        entries = fresh?.[0]?.[1] ?? [];

        // Reclaiming crashed-consumer messages only needs to happen
        // occasionally, not on every idle poll — it halves the idle Upstash
        // command spend.
        if (entries.length === 0 && idlePolls % 6 === 0) {
          const claimed = await this.redis.cmd<[string, StreamEntry[], string[]?]>(
            "XAUTOCLAIM", topic, group, consumer, AUTOCLAIM_IDLE_MS, "0", "COUNT", batchSize
          );
          entries = claimed?.[1] ?? [];
        }
        idlePolls = entries.length === 0 ? idlePolls + 1 : 0;
      } catch (err) {
        console.error(`[bus] read error on ${topic}:`, err);
        await sleep(pollMs * 2);
        continue;
      }

      if (entries.length === 0) {
        await sleep(pollMs);
        continue;
      }

      for (const [id, fields] of entries) {
        const payload = fieldValue(fields, "payload");
        if (payload === null) {
          await this.ack(topic, group, id);
          continue;
        }
        try {
          await handler(JSON.parse(payload) as T, id);
          await this.ack(topic, group, id);
        } catch (err) {
          console.error(`[bus] handler failed for ${topic}/${id}:`, err);
          await this.deadLetterIfExhausted(topic, group, id, payload);
        }
      }
    }
  }

  private async ack(topic: string, group: string, id: string): Promise<void> {
    await this.redis.cmd("XACK", topic, group, id);
  }

  private async deadLetterIfExhausted(
    topic: string, group: string, id: string, payload: string
  ): Promise<void> {
    try {
      const pending = await this.redis.cmd<[string, string, number, number][]>(
        "XPENDING", topic, group, id, id, 1
      );
      const deliveries = pending?.[0]?.[3] ?? 0;
      if (deliveries >= MAX_DELIVERIES) {
        await this.redis.cmd(
          "XADD", `${topic}-dlq`, "MAXLEN", "~", 1000, "*",
          "payload", payload, "origin_id", id
        );
        await this.ack(topic, group, id);
        console.error(`[bus] dead-lettered ${topic}/${id} after ${deliveries} deliveries`);
      }
    } catch (err) {
      console.error(`[bus] dead-letter check failed for ${topic}/${id}:`, err);
    }
  }
}

function fieldValue(fields: string[], name: string): string | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === name) return fields[i + 1];
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
