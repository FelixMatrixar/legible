import { ESBUILD_NAME_SHIM, extractPageFacts, type ExtractedElement } from "@legible/shared";
import type { Page } from "playwright";

/** The function-calling surface from spec §1.5, implemented over Playwright. */

export interface PerceptionSnapshot {
  url: string;
  title: string;
  elements: ExtractedElement[];
}

export type NavAction =
  | { type: "click"; ref: string }
  | { type: "clickAt"; x: number; y: number }
  | { type: "type"; ref: string; text: string }
  | { type: "scroll"; direction: "up" | "down" };

export async function listInteractiveElements(page: Page): Promise<PerceptionSnapshot> {
  await page.evaluate(ESBUILD_NAME_SHIM);
  const facts = await page.evaluate(extractPageFacts, true);
  return { url: facts.url, title: facts.title, elements: facts.interactive };
}

export async function captureScreenshot(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "png" });
  return buf.toString("base64");
}

export async function getVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

export async function executeAction(page: Page, action: NavAction): Promise<void> {
  switch (action.type) {
    case "click":
      await page.click(`[data-legible-ref="${action.ref}"]`, { timeout: 5000 });
      break;
    case "clickAt":
      await page.mouse.click(action.x, action.y);
      break;
    case "type": {
      const locator = page.locator(`[data-legible-ref="${action.ref}"]`);
      try {
        await locator.fill(action.text, { timeout: 5000 });
      } catch {
        await locator.click({ timeout: 5000 });
        await page.keyboard.type(action.text);
      }
      break;
    }
    case "scroll":
      await page.mouse.wheel(0, action.direction === "down" ? 600 : -600);
      break;
  }
  // Let any triggered navigation / rerender settle before verification.
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export function describeAction(action: NavAction | null, snapshot?: PerceptionSnapshot): string {
  if (!action) return "none";
  switch (action.type) {
    case "click": {
      const el = snapshot?.elements.find((e) => e.ref === action.ref);
      return `click(${action.ref}${el ? ` "${el.accessibleName || el.role}"` : ""})`;
    }
    case "clickAt":
      return `clickAt(${action.x},${action.y})`;
    case "type":
      return `type(${action.ref}, "${action.text.slice(0, 30)}")`;
    case "scroll":
      return `scroll(${action.direction})`;
  }
}

/** Cheap state fingerprint: url + title + hashed visible text. */
export async function fingerprint(page: Page): Promise<string> {
  const url = page.url();
  const [title, text] = await Promise.all([
    page.title().catch(() => ""),
    getVisibleText(page).catch(() => ""),
  ]);
  return `${url}|${title}|${djb2(text.slice(0, 4000))}`;
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}
