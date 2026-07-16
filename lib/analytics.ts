import { monthlyCost } from "@/lib/format";

export interface SubForAnalytics {
  amount: number;
  cadence: string;
  category: string;
}

export interface TxForAnalytics {
  date: Date;
  amount: number;
  isSubscription: boolean;
}

/** Monthly-normalized spend per category, largest first. */
export function categoryBreakdown(
  subs: SubForAnalytics[]
): { category: string; amount: number }[] {
  const byCategory = new Map<string, number>();
  for (const s of subs) {
    const m = monthlyCost(s.amount, s.cadence);
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + m);
  }
  return [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Total subscription spend per calendar month (last `months` months present in
 * the data), for the trend line. Only subscription-linked transactions count.
 */
export function monthlyTrend(
  transactions: TxForAnalytics[],
  months = 6
): { month: string; amount: number }[] {
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!t.isSubscription) continue;
    const key = `${t.date.getUTCFullYear()}-${String(
      t.date.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.amount);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-months)
    .map(([key, amount]) => {
      const month = Number(key.slice(5, 7)) - 1;
      return { month: MONTH_LABELS[month], amount: Math.round(amount * 100) / 100 };
    });
}
