/** Sanity-check the AI goal classifier on tricky cases. */
import "dotenv/config";
import { LlmClient, classifyGoalWithAI } from "../packages/llm/src/index";

const llm = new LlmClient();
const cases: [string, string][] = [
  ["qa job list", "read-only"],
  ["find the qa job list", "read-only"],
  ["show me the pricing", "read-only"],
  ["the projects section", "read-only"],
  ["complete the contact form", "mutating"],
  ["sign up for the newsletter", "mutating"],
  ["add the item to my cart", "mutating"],
  ["book a demo call", "mutating"],
];

for (const [goal, expected] of cases) {
  const got = await classifyGoalWithAI(llm, goal);
  const mark = got === expected ? "ok " : "??";
  console.log(`${mark} "${goal}"  ->  ${got}  (expected ${expected})`);
}
