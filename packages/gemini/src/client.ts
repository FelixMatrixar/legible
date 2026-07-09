import { GeminiKeyPool } from "./keyPool";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GenerateOptions {
  system?: string;
  prompt: string;
  /** Base64-encoded PNG attached for the visual-fallback path. */
  imageBase64Png?: string;
  /** Gemini responseSchema (OpenAPI-style subset). Forces JSON output. */
  schema?: unknown;
  temperature?: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

export class GeminiClient {
  constructor(
    private readonly pool = new GeminiKeyPool(),
    private readonly model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite"
  ) {}

  /** Single text/JSON completion. Retries transient failures; every attempt
   *  consumes one call slot in the pool, so the 5-calls-per-key invariant holds. */
  async generateText(opts: GenerateOptions): Promise<string> {
    const parts: unknown[] = [{ text: opts.prompt }];
    if (opts.imageBase64Png) {
      parts.push({ inline_data: { mime_type: "image/png", data: opts.imageBase64Png } });
    }

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.schema
          ? { response_mime_type: "application/json", response_schema: opts.schema }
          : {}),
      },
    };
    if (opts.system) {
      body.system_instruction = { parts: [{ text: opts.system }] };
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = await this.pool.acquire();
      try {
        const res = await fetch(`${BASE}/models/${this.model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
        });
        if (res.status === 403) {
          // Key rejected (e.g. its project is blocked) — switch to the next
          // key in the pool and retry.
          lastError = new Error(`Gemini 403: ${await res.text()}`);
          this.pool.switchKey();
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Gemini ${res.status}: ${await res.text()}`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
        const data = (await res.json()) as GeminiResponse;
        if (!res.ok) {
          throw new Error(`Gemini ${res.status}: ${data.error?.message ?? "unknown error"}`);
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (!text) throw new Error("Gemini returned an empty completion");
        return text;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!isTransient(lastError)) throw lastError;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastError ?? new Error("Gemini call failed");
  }

  async generateJson<T>(opts: GenerateOptions): Promise<T> {
    const text = await this.generateText(opts);
    try {
      return JSON.parse(text) as T;
    } catch {
      // Occasionally models wrap JSON in a code fence despite the mime type.
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as T;
      throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}`);
    }
  }
}

function isTransient(err: Error): boolean {
  return /429|5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|empty completion/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
