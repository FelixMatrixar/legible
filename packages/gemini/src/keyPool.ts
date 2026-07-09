/**
 * Round-robin Gemini key pool.
 *
 * Keys are discovered from GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... — add as
 * many as you like. Rotation rule: every key must serve exactly 5 calls
 * before the pool advances to the next key (call 1–5 → key 1, call 6–10 →
 * key 2, ... wrapping around).
 */
export const CALLS_PER_KEY = 5;

export class GeminiKeyPool {
  private readonly keys: string[];
  private readonly maxRpmPerKey: number;
  private readonly callTimes: number[][];
  private callCount = 0;

  constructor(
    env: Record<string, string | undefined> = process.env,
    maxRpmPerKey = Number(env.GEMINI_MAX_RPM_PER_KEY ?? 10)
  ) {
    this.keys = [];
    for (let i = 1; ; i++) {
      const key = env[`GEMINI_API_KEY_${i}`];
      if (!key) break;
      this.keys.push(key);
    }
    if (this.keys.length === 0) {
      throw new Error("No Gemini keys found — set GEMINI_API_KEY_1 (and _2, _3, ...) in the environment.");
    }
    this.maxRpmPerKey = maxRpmPerKey;
    this.callTimes = this.keys.map(() => []);
  }

  get size(): number {
    return this.keys.length;
  }

  private currentIndex(): number {
    return Math.floor(this.callCount / CALLS_PER_KEY) % this.keys.length;
  }

  /** Returns the key for the next call and advances the counter. */
  next(): string {
    const index = this.currentIndex();
    this.callCount++;
    return this.keys[index];
  }

  /** Skips the rest of the current key's window: the next call uses the
   *  next key. Used when a key is rejected (e.g. Gemini 403). */
  switchKey(): void {
    this.callCount = (Math.floor(this.callCount / CALLS_PER_KEY) + 1) * CALLS_PER_KEY;
  }

  /**
   * Rate-limited next(): if the scheduled key has already served
   * GEMINI_MAX_RPM_PER_KEY calls in the last 60s, waits until it is under
   * its cap. The 5-calls-per-key rotation order is never altered — the
   * throttle only delays, it never skips ahead to another key.
   */
  async acquire(): Promise<string> {
    const index = this.currentIndex();
    const now = Date.now();
    const recent = this.callTimes[index].filter((t) => now - t < 60_000);
    if (recent.length >= this.maxRpmPerKey) {
      const waitMs = 60_000 - (now - recent[0]) + 50;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    this.callTimes[index] = [
      ...this.callTimes[index].filter((t) => Date.now() - t < 60_000),
      Date.now(),
    ];
    return this.next();
  }
}
