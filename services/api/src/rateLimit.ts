import type { NextFunction, Request, Response } from "express";

/**
 * In-memory sliding-window limiter for mutating routes. Keyed by caller
 * identity (API key vs IP). Fine for a single API instance; move to a Redis
 * counter if the API is ever scaled horizontally.
 */
export function rateLimit(
  maxPerMinute = Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30)
) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header("x-api-key") ? "api-key" : (req.ip ?? "unknown");
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);

    if (recent.length >= maxPerMinute) {
      res
        .status(429)
        .json({ error: `Rate limit exceeded: max ${maxPerMinute} requests/minute.` });
      return;
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
