import type { SubscriptionCadence } from "@/lib/types";

export interface DetectionInput {
  id: string;
  date: Date;
  amount: number;
  rawDescription: string;
}

export interface RecurringCandidate {
  key: string; // merchant grouping key (-> Merchant.rawPattern)
  sampleDescription: string; // a representative raw description
  cadence: SubscriptionCadence;
  amount: number; // most recent charge amount
  occurrences: number;
  firstSeen: Date;
  lastCharged: Date;
  transactionIds: string[];
}

const DAY = 24 * 60 * 60 * 1000;

// Cadence windows in days (see docs/HLD.md §3.2).
const CADENCE_RANGES: Record<SubscriptionCadence, [number, number]> = {
  weekly: [5, 9],
  monthly: [25, 35],
  yearly: [355, 375],
};

const MIN_OCCURRENCES: Record<SubscriptionCadence, number> = {
  weekly: 3,
  monthly: 2,
  yearly: 2,
};

const AMOUNT_TOLERANCE = 0.15; // ±15% of the median

/**
 * Collapse a raw bank description into a stable merchant grouping key by
 * stripping the volatile parts (store/phone/order numbers, `#`/`*` markers).
 * The same merchant across months must produce the same key.
 */
export function merchantKey(rawDescription: string): string {
  return rawDescription
    .toUpperCase()
    .replace(/\b\d{2,}\b/g, " ") // standalone digit runs
    .replace(/[#*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** All amounts within ±15% of the median. */
function amountsStable(amounts: number[]): boolean {
  const m = median(amounts);
  if (m <= 0) return false;
  return amounts.every((a) => Math.abs(a - m) / m <= AMOUNT_TOLERANCE);
}

/**
 * Classify a set of consecutive-day intervals into a cadence, requiring the
 * median interval to fall in a cadence window and most intervals to agree.
 */
function classifyCadence(intervals: number[]): SubscriptionCadence | null {
  if (intervals.length === 0) return null;
  const med = median(intervals);

  for (const cadence of ["weekly", "monthly", "yearly"] as const) {
    const [lo, hi] = CADENCE_RANGES[cadence];
    if (med < lo || med > hi) continue;
    const agree = intervals.filter((d) => d >= lo && d <= hi).length;
    if (agree / intervals.length >= 0.5) return cadence;
  }
  return null;
}

/**
 * Stage 1 of subscription detection: group transactions by merchant and keep
 * only those that recur on a stable cadence with a stable amount. Pure and
 * deterministic — no network calls. See docs/HLD.md §3.2.
 */
export function detectRecurring(
  transactions: DetectionInput[]
): RecurringCandidate[] {
  const groups = new Map<string, DetectionInput[]>();
  for (const tx of transactions) {
    const key = merchantKey(tx.rawDescription);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(tx);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [key, txsRaw] of groups) {
    const txs = [...txsRaw].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    if (txs.length < 2) continue;

    const amounts = txs.map((t) => t.amount);
    if (!amountsStable(amounts)) continue;

    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      intervals.push(
        Math.round((txs[i].date.getTime() - txs[i - 1].date.getTime()) / DAY)
      );
    }

    const cadence = classifyCadence(intervals);
    if (!cadence) continue;
    if (txs.length < MIN_OCCURRENCES[cadence]) continue;

    const last = txs[txs.length - 1];
    candidates.push({
      key,
      sampleDescription: last.rawDescription,
      cadence,
      amount: last.amount,
      occurrences: txs.length,
      firstSeen: txs[0].date,
      lastCharged: last.date,
      transactionIds: txs.map((t) => t.id),
    });
  }

  return candidates;
}

/** Estimate the next charge date from the last charge and cadence. */
export function nextBilling(lastCharged: Date, cadence: SubscriptionCadence): Date {
  const d = new Date(lastCharged);
  if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (cadence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}
