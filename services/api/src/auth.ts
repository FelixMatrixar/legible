import type { NextFunction, Request, Response } from "express";

/**
 * Single-operator auth: every caller (dashboard, curl, GitHub Actions)
 * presents X-API-Key matching INTERNAL_API_KEY. No user accounts —
 * this is a personal tool, per the spec's "out of scope" list.
 */
export function requireCaller(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    res.status(503).json({ error: "INTERNAL_API_KEY is not configured on the server." });
    return;
  }
  if (req.header("x-api-key") === expected) {
    res.locals.callerId = "operator";
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized: provide X-API-Key." });
}
