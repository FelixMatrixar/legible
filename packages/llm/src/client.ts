const BASE = "https://openrouter.ai/api/v1";

export interface GenerateOptions {
  system?: string;
  prompt: string;
  /** Base64-encoded PNG attached for the visual-fallback path (needs a
   *  vision-capable model). */
  imageBase64Png?: string;
  /** When set, output is requested as a single JSON object. The exact shape
   *  is described by the prompt; this only flips JSON mode on. */
  schema?: unknown;
  temperature?: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * OpenRouter chat client (OpenAI-compatible). Single API key — the old
 * round-robin key pool is gone. Set OPENROUTER_MODEL to any model id
 * OpenRouter serves; the default is a vision-capable Gemini model so the
 * agent's visual-fallback path keeps working.
 */
export class LlmClient {
  constructor(
    private readonly apiKey = process.env.OPENROUTER_API_KEY,
    private readonly model = process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite"
  ) {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY must be set");
  }

  async generateText(opts: GenerateOptions): Promise<string> {
    const userContent: string | ContentPart[] = opts.imageBase64Png
      ? [
          { type: "text", text: opts.prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${opts.imageBase64Png}` } },
        ]
      : opts.prompt;

    const messages: { role: string; content: string | ContentPart[] }[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: userContent });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      // Structured output: the model is constrained to the exact JSON Schema,
      // so required fields (e.g. an action's `type`) can't be omitted.
      ...(opts.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "response", strict: false, schema: opts.schema },
            },
          }
        : {}),
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://github.com/legible",
            "X-Title": "legible",
          },
          body: JSON.stringify(body),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`OpenRouter ${res.status}: ${await res.text()}`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
        const data = (await res.json()) as ChatResponse;
        if (!res.ok) {
          throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? "unknown error"}`);
        }
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text) throw new Error("OpenRouter returned an empty completion");
        return text;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!isTransient(lastError)) throw lastError;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastError ?? new Error("OpenRouter call failed");
  }

  async generateJson<T>(opts: GenerateOptions): Promise<T> {
    const text = await this.generateText(opts);
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some models wrap JSON in a code fence despite json mode.
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as T;
      throw new Error(`OpenRouter returned non-JSON output: ${text.slice(0, 200)}`);
    }
  }
}

function isTransient(err: Error): boolean {
  return /429|5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|empty completion/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
