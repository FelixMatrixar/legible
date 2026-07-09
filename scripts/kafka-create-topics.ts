/** One-time: create the smoke-test and dead-letter topics (Redpanda
 *  Serverless doesn't auto-create topics on produce). */
import "dotenv/config";
import { Kafka, logLevel, type SASLOptions } from "kafkajs";

const kafka = new Kafka({
  clientId: "legible-admin",
  brokers: (process.env.KAFKA_BROKERS ?? "").split(",").map((b) => b.trim()),
  ssl: process.env.KAFKA_SSL === "true" ? true : undefined,
  sasl: {
    mechanism: process.env.KAFKA_SASL_MECHANISM ?? "scram-sha-256",
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
  } as SASLOptions,
  logLevel: logLevel.NOTHING,
});

const TOPICS = [
  "legible-smoke",
  "pages-to-audit-dlq",
  "agent-results-dlq",
  "structure-results-dlq",
];

const admin = kafka.admin();
await admin.connect();
const created = await admin.createTopics({
  topics: TOPICS.map((topic) => ({ topic, numPartitions: 1 })),
  waitForLeaders: true,
});
console.log(created ? `created: ${TOPICS.join(", ")}` : "all topics already existed");
await admin.disconnect();
