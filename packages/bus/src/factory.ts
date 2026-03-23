import { EventBus } from "./bus";
import type { Bus } from "./contract";
import { KafkaBus } from "./kafka";

/**
 * Driver selection: BUS_DRIVER=kafka|redis wins; otherwise Kafka whenever
 * KAFKA_BROKERS is configured, falling back to Upstash Redis Streams.
 * Redis stays required either way — live dashboard state, the scorer's
 * join, and progress counters live there, not on the event backbone.
 */
export function createBus(): Bus {
  const driver = process.env.BUS_DRIVER ?? (process.env.KAFKA_BROKERS ? "kafka" : "redis");
  if (driver === "kafka") return new KafkaBus();
  if (driver !== "redis") {
    console.warn(`[bus] unknown BUS_DRIVER '${driver}', falling back to redis streams`);
  }
  return new EventBus();
}
