const DAY = 24 * 60 * 60 * 1000;

export const RENEWAL_WINDOW_DAYS = 30;

export interface RenewalItem {
  id: string;
  name: string;
  category: string;
  amount: number;
  cadence: string;
  nextBillingEstimate: Date;
}

export interface RenewalGroup {
  label: string;
  items: RenewalItem[];
}

export interface UpcomingRenewals {
  groups: RenewalGroup[];
  /** What will actually be charged in the window — real amounts, not monthly-normalized. */
  total: number;
  count: number;
}

/** Whole days from `now` until `d`; negative when `d` is in the past. */
export function daysUntil(d: Date, now: number): number {
  return (d.getTime() - now) / DAY;
}

/**
 * Group the subscriptions billing in the next 30 days into "this week / next
 * week / later this month". Pure — the dashboard renders whatever comes back.
 *
 * Anything already past its estimate is excluded: that's overdue, not
 * upcoming, and the dashboard badges it separately.
 */
export function groupUpcoming(
  subs: RenewalItem[],
  now = new Date()
): UpcomingRenewals {
  const t = now.getTime();

  const upcoming = subs
    .filter((s) => {
      const d = daysUntil(s.nextBillingEstimate, t);
      return d >= 0 && d <= RENEWAL_WINDOW_DAYS;
    })
    .sort(
      (a, b) => a.nextBillingEstimate.getTime() - b.nextBillingEstimate.getTime()
    );

  // Half-open buckets [min, max) so every day lands in exactly one. The last
  // one is just "Later": the window is a rolling 30 days, so it routinely
  // spills into the next calendar month and can't claim to be "this month".
  const buckets = [
    { label: "This week", min: 0, max: 7 },
    { label: "Next week", min: 7, max: 14 },
    { label: "Later", min: 14, max: RENEWAL_WINDOW_DAYS + 1 },
  ];

  const groups: RenewalGroup[] = [];
  for (const bucket of buckets) {
    const items = upcoming.filter((s) => {
      const d = daysUntil(s.nextBillingEstimate, t);
      return d >= bucket.min && d < bucket.max;
    });
    if (items.length > 0) groups.push({ label: bucket.label, items });
  }

  return {
    groups,
    total: upcoming.reduce((sum, s) => sum + s.amount, 0),
    count: upcoming.length,
  };
}
