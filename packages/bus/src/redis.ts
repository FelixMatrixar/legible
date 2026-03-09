/**
 * Minimal Upstash Redis REST client. Any Redis command can be sent as a JSON
 * array — no persistent TCP connection, which is the whole point for workers.
 */
export class UpstashRedis {
  private readonly url: string;
  private readonly token: string;

  constructor(
    url = process.env.UPSTASH_REDIS_REST_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    if (!url || !token) {
      throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set");
    }
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }

  async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (body.error !== undefined) {
      throw new Error(`Upstash: ${body.error}`);
    }
    return body.result as T;
  }

  /** Many commands in one round-trip (Upstash /pipeline endpoint). */
  async pipeline<T = unknown>(commands: (string | number)[][]): Promise<T[]> {
    if (commands.length === 0) return [];
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands.map((c) => c.map(String))),
    });
    const body = (await res.json()) as { result?: T; error?: string }[];
    return body.map((r) => {
      if (r.error !== undefined) throw new Error(`Upstash: ${r.error}`);
      return r.result as T;
    });
  }
}
