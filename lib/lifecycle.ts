import { prisma } from "@/lib/db";
import type { SubscriptionCadence } from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long a subscription may go unbilled before we assume it's no longer
 * running: twice its expected cadence, so a single skipped or late charge
 * doesn't retire it. Mirrors the CADENCE_DAYS basis in lib/insights.ts.
 */
const STALE_AFTER_DAYS: Record<SubscriptionCadence, number> = {
  weekly: 14,
  monthly: 60,
  yearly: 730,
};

/**
 * Retire active subscriptions that have stopped being charged (docs/HLD.md
 * §3.2 Stage 4). Without this a cancelled service stays `active` forever and
 * keeps inflating the monthly and yearly totals — the numbers this app exists
 * to get right.
 *
 * `stale` is system-set only; detection revives it automatically when a newer
 * charge shows up (lib/detect.ts), and the user can Reactivate by hand.
 *
 * Returns how many subscriptions were retired.
 */
export async function applyStaleStatus(
  userId: string,
  now = new Date()
): Promise<number> {
  const cadences = Object.keys(STALE_AFTER_DAYS) as SubscriptionCadence[];

  const results = await Promise.all(
    cadences.map((cadence) =>
      prisma.subscription.updateMany({
        where: {
          userId,
          status: "active",
          cadence,
          // Manual subscriptions have no transactions behind them: lastCharged
          // is whatever it was created with and never advances, so including
          // them here would retire every hand-added subscription.
          isManual: false,
          lastCharged: { lt: new Date(now.getTime() - STALE_AFTER_DAYS[cadence] * DAY) },
        },
        data: { status: "stale" },
      })
    )
  );

  return results.reduce((sum, r) => sum + r.count, 0);
}
