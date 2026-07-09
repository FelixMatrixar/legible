/** Live OpenRouter round-trip: plain text + JSON (the agent's planner shape). */
import "dotenv/config";
import { LlmClient } from "../packages/llm/src/client";

const llm = new LlmClient();

const text = await llm.generateText({ prompt: "Reply with exactly: pong" });
console.log("text call ->", JSON.stringify(text.trim()));

const json = await llm.generateJson<{ status: string; n: number }>({
  system: "You output JSON only.",
  prompt: 'Return this exact object: {"status":"ok","n":3}',
  schema: {},
});
console.log("json call ->", JSON.stringify(json));
console.log("model:", process.env.OPENROUTER_MODEL);
