import { prisma } from "@/lib/db";

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

/**
 * Per-account brute-force protection. Keyed on the email that was *typed*,
 * whether or not it exists, so a lockout can't be used to probe which
 * accounts are real.
 */
export const LOGIN_PER_EMAIL: RateLimitPolicy = { limit: 10, windowSeconds: 15 * 60 };

/** Catches one host spraying a few guesses each across many accounts. */
export const LOGIN_PER_IP: RateLimitPolicy = { limit: 30, windowSeconds: 15 * 60 };

/** Account-creation spam. */
export const SIGNUP_PER_IP: RateLimitPolicy = { limit: 5, windowSeconds: 60 * 60 };

export interface RateLimitStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

const ALLOWED: RateLimitStatus = { blocked: false, retryAfterSeconds: 0 };

/** Rows older than this are dead weight — nothing reads a long-expired window. */
const PRUNE_AFTER_SECONDS = 24 * 60 * 60;

function expired(windowStart: Date, policy: RateLimitPolicy, now: Date): boolean {
  return now.getTime() - windowStart.getTime() >= policy.windowSeconds * 1000;
}

/**
 * Is this key currently locked out? Read-only — call `recordAttempt` to count
 * one against the limit.
 */
export async function isRateLimited(
  key: string,
  policy: RateLimitPolicy,
  now = new Date()
): Promise<RateLimitStatus> {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row) return ALLOWED;
  if (expired(row.windowStart, policy, now)) return ALLOWED;
  if (row.count < policy.limit) return ALLOWED;

  const elapsed = (now.getTime() - row.windowStart.getTime()) / 1000;
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil(policy.windowSeconds - elapsed)),
  };
}

/**
 * Count one attempt against `key`, starting a fresh window if the old one has
 * expired.
 *
 * The window is fixed rather than sliding, so a burst straddling a boundary can
 * land up to 2x the limit in quick succession. That is a fine trade here: it
 * still turns unlimited guessing into a few dozen tries per 15 minutes.
 */
export async function recordAttempt(
  key: string,
  policy: RateLimitPolicy,
  now = new Date()
): Promise<void> {
  const row = await prisma.rateLimit.findUnique({ where: { key } });

  if (!row || expired(row.windowStart, policy, now)) {
    await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, windowStart: now },
      update: { count: 1, windowStart: now },
    });
  } else {
    // increment server-side so concurrent attempts can't overwrite each other
    await prisma.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
  }

  await pruneOccasionally(now);
}

/** Wipe a key's history — used when a real sign-in proves the user is legit. */
export async function clearAttempts(key: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

/**
 * Distinct keys (every email an attacker tries) each leave a row behind, so
 * they need collecting. There's no cron here, so piggyback on write traffic —
 * roughly 1 in 50 attempts pays for the cleanup.
 */
async function pruneOccasionally(now: Date): Promise<void> {
  if (Math.random() >= 0.02) return;
  await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - PRUNE_AFTER_SECONDS * 1000) } },
  });
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for; locally it's usually
 * absent, in which case every caller shares the "unknown" bucket — fine for
 * dev, and the per-email limit is the one that matters anyway.
 */
export function clientIp(req: Request | undefined): string {
  const forwarded = req?.headers?.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req?.headers?.get("x-real-ip")?.trim() || "unknown";
}

export const loginEmailKey = (email: string) => `login:email:${email}`;
export const loginIpKey = (ip: string) => `login:ip:${ip}`;
export const signupIpKey = (ip: string) => `signup:ip:${ip}`;

/** "in about 3 minutes" — for user-facing lockout copy. */
export function humanizeRetry(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "in about a minute";
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}
