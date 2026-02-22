/**
 * In-browser extraction, shared by both audit workers via page.evaluate().
 *
 * MUST stay fully self-contained (no imports, no closures) — Playwright
 * serializes the function source and runs it inside the page.
 */

export interface ExtractedElement {
  ref: string;
  role: string;
  accessibleName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface ExtractedTextBlock {
  selector: string;
  text: string;
}

export interface PageFacts {
  url: string;
  title: string;
  metaDescription: string;
  jsonLdBlocks: string[];
  headingOrder: number[];
  images: { total: number; withAlt: number };
  interactive: ExtractedElement[];
  textBlocks: ExtractedTextBlock[];
}

export function extractPageFacts(assignRefs: boolean): PageFacts {
  function accName(el: Element): string {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const label = (el.labels && el.labels[0]?.textContent) ?? "";
      if (label.trim()) return label.replace(/\s+/g, " ").trim();
      if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button") && el.value.trim()) {
        return el.value.trim();
      }
    }

    const imgAlt = el.querySelector("img[alt]")?.getAttribute("alt");
    if (imgAlt && imgAlt.trim()) return imgAlt.trim();

    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 80);

    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    return "";
  }

  function roleOf(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el as HTMLInputElement).type;
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    return tag;
  }

  function cssPath(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 4) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag);
      cur = parent;
    }
    return parts.join(" > ");
  }

  const interactiveSelector =
    'a[href], button, input:not([type="hidden"]), select, textarea, ' +
    '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]';
  const seen = new Set<Element>();
  const interactive: ExtractedElement[] = [];
  let refCounter = 0;

  for (const el of Array.from(document.querySelectorAll(interactiveSelector))) {
    if (seen.has(el)) continue;
    seen.add(el);
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0) continue;
    if (style.display === "none" || style.visibility === "hidden") continue;

    const ref = `e${++refCounter}`;
    if (assignRefs) el.setAttribute("data-legible-ref", ref);
    interactive.push({
      ref,
      role: roleOf(el),
      accessibleName: accName(el),
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  const headingOrder = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) =>
    parseInt(h.tagName.slice(1), 10)
  );

  const imgs = Array.from(document.querySelectorAll("img"));
  const withAlt = imgs.filter((i) => {
    const alt = i.getAttribute("alt");
    return alt !== null && alt.trim().length > 2;
  }).length;

  const jsonLdBlocks = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]')
  ).map((s) => s.textContent ?? "");

  const textBlocks: ExtractedTextBlock[] = [];
  for (const el of Array.from(document.querySelectorAll("main p, article p, h1, h2, p, li"))) {
    if (textBlocks.length >= 12) break;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 40) continue;
    textBlocks.push({ selector: cssPath(el), text: text.slice(0, 200) });
  }

  return {
    url: location.href,
    title: document.title ?? "",
    metaDescription:
      document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    jsonLdBlocks,
    headingOrder,
    images: { total: imgs.length, withAlt },
    interactive,
    textBlocks,
  };
}
