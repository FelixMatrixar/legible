/**
 * Live Kafka round-trip check: publishes one message and consumes it back
 * through the real KafkaBus driver. Needs a reachable broker:
 *
 *   docker compose up -d redpanda
 *   npm run smoke:kafka
 */
import "dotenv/config";
import { KafkaBus } from "../packages/bus/src/kafka";

process.env.KAFKA_BROKERS ??= "localhost:9092";

const bus = new KafkaBus();
const topic = "legible-smoke";
const probe = { hello: "kafka", at: new Date().toISOString() };

const timeout = setTimeout(() => {
  console.error("FAIL: no message received within 30s — is the broker up?");
  process.exit(1);
}, 30_000);

const controller = new AbortController();

async function main(): Promise<void> {
  const consuming = bus.consume<typeof probe>(
    topic,
    "smoke",
    "smoke-1",
    async (msg) => {
      if (msg.at === probe.at) {
        console.log("OK: round-trip succeeded —", msg);
        clearTimeout(timeout);
        controller.abort();
      }
    },
    { signal: controller.signal }
  );

  // Give the consumer a moment to join the group before producing.
  await new Promise((r) => setTimeout(r, 3000));
  await bus.publish(topic, probe);
  console.log("published probe, waiting for it to come back...");

  await consuming;
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
