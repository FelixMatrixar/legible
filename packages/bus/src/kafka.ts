import { Kafka, logLevel, type Producer, type SASLOptions } from "kafkajs";
import type { Bus, ConsumeOptions, Handler } from "./contract";

const MAX_ATTEMPTS = 5;

/**
 * Apache Kafka driver (kafkajs). Configuration via env:
 *   KAFKA_BROKERS         comma-separated host:port list
 *   KAFKA_USERNAME/_PASSWORD  SASL credentials (cloud brokers)
 *   KAFKA_SASL_MECHANISM  plain | scram-sha-256 | scram-sha-512 (default scram-sha-256)
 *   KAFKA_SSL             "true" for TLS (required by most cloud brokers)
 *
 * Consumer groups are namespaced `<group>.<topic>` so each consume() call is
 * an independent group per topic — the same semantics the Redis Streams
 * driver has (groups live per-stream), and it keeps every group's members
 * subscribed to exactly one topic, which Kafka's assigners expect.
 */
export class KafkaBus implements Bus {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? "")
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    if (brokers.length === 0) {
      throw new Error("KAFKA_BROKERS must be set to use the kafka bus driver");
    }

    const username = process.env.KAFKA_USERNAME;
    const password = process.env.KAFKA_PASSWORD;
    const sasl =
      username && password
        ? ({
            mechanism: process.env.KAFKA_SASL_MECHANISM ?? "scram-sha-256",
            username,
            password,
          } as SASLOptions)
        : undefined;

    this.kafka = new Kafka({
      clientId: "legible",
      brokers,
      ssl: process.env.KAFKA_SSL === "true" ? true : undefined,
      sasl,
      logLevel: logLevel.ERROR,
    });
  }

  private async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
      await this.producer.connect();
    }
    return this.producer;
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    const producer = await this.getProducer();
    await producer.send({
      topic,
      messages: [{ value: JSON.stringify(payload) }],
    });
  }

  async consume<T>(
    topic: string,
    group: string,
    consumerName: string,
    handler: Handler<T>,
    opts: ConsumeOptions = {}
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId: `${group}.${topic}`,
      // Navigation audits hold a message for minutes; generous session +
      // manual heartbeats below keep the group from rebalancing mid-audit.
      sessionTimeout: 60_000,
      heartbeatInterval: 5_000,
    });
    await consumer.connect();
    // fromBeginning mirrors XGROUP CREATE at id 0: a brand-new group replays
    // the topic's retained history, so late-added analysis stages can
    // reprocess old events without re-crawling.
    await consumer.subscribe({ topic, fromBeginning: true });
    console.log(`[bus:kafka] consuming ${topic} as ${group}/${consumerName}`);

    const lifecycle = new Promise<void>((resolve, reject) => {
      consumer.on(consumer.events.CRASH, ({ payload }) => {
        if (!payload.restart) reject(payload.error);
      });
      opts.signal?.addEventListener("abort", () => {
        consumer.disconnect().then(resolve, reject);
      });
    });

    await consumer.run({
      eachMessage: async ({ message, heartbeat }) => {
        const raw = message.value?.toString("utf8");
        if (!raw) return;
        let parsed: T;
        try {
          parsed = JSON.parse(raw) as T;
        } catch {
          console.error(`[bus:kafka] non-JSON message on ${topic}@${message.offset}, skipping`);
          return;
        }

        const beat = setInterval(() => {
          void heartbeat().catch(() => {});
        }, 10_000);
        try {
          for (let attempt = 1; ; attempt++) {
            try {
              await handler(parsed, `${topic}@${message.offset}`);
              return;
            } catch (err) {
              console.error(
                `[bus:kafka] handler failed (${attempt}/${MAX_ATTEMPTS}) on ${topic}@${message.offset}:`,
                err
              );
              if (attempt >= MAX_ATTEMPTS) {
                await this.deadLetter(topic, raw, message.offset);
                return;
              }
              await sleep(1000 * attempt);
            }
          }
        } finally {
          clearInterval(beat);
        }
      },
    });

    await lifecycle;
  }

  private async deadLetter(topic: string, raw: string, offset: string): Promise<void> {
    try {
      const producer = await this.getProducer();
      await producer.send({
        topic: `${topic}-dlq`,
        messages: [{ value: raw, headers: { origin_topic: topic, origin_offset: offset } }],
      });
      console.error(`[bus:kafka] dead-lettered ${topic}@${offset}`);
    } catch (err) {
      console.error(`[bus:kafka] dead-letter publish failed for ${topic}@${offset}:`, err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
