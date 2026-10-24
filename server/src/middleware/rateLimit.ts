import { NextFunction, Request, Response } from 'express';
import { HttpError } from '../types';

/**
 * A small in-memory rate limiter, enough for one server instance: at most `max`
 * requests per IP address in each `windowMs`. Used on sign-in and registration to
 * slow down password guessing once the site is on the public internet.
 */
export function rateLimit({ max, windowMs, message }: { max: number; windowMs: number; message: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      // Drop expired entries now and then so the map can't grow without bound
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return next();
    }
    if (entry.count >= max) throw new HttpError(429, message);
    entry.count++;
    next();
  };
}
