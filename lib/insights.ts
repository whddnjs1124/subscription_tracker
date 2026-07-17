import { prisma } from "@/lib/db";
import { monthlyCost } from "@/lib/format";
import { categoryBreakdown } from "@/lib/analytics";

export interface DuplicateWarning {
  category: string;
  names: string[];
  monthlyTotal: number;
}

export interface StaleSubscription {
  id: string;
  name: string;
  lastCharged: Date;
  amount: number;
  cadence: string;
}

export interface InsightStats {
  monthlyTotal: number;
  yearlyTotal: number;
  activeCount: number;
  topCategory: { category: string; amount: number } | null;
  mostExpensive: { name: string; monthly: number } | null;
  categoryBreakdown: { category: string; amount: number }[];
  duplicateWarnings: DuplicateWarning[];
  staleSubscriptions: StaleSubscription[];
}

/**
 * Deterministic subscription insights computed directly from the database —
 * no AI required. The AI narrative (lib/gemini) is layered on top separately.
 *
 * Totals cover `active` subscriptions only, so anything lib/lifecycle.ts has
 * retired as `stale` drops out of the spend figures automatically.
 */
export async function computeInsights(userId: string): Promise<InsightStats> {
  const [subscriptions, staleRows] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId, status: "active" },
      include: { merchant: true },
    }),
    // Stale is a stored status now (set by applyStaleStatus), not something we
    // recompute here — one definition, used by the totals and this list alike.
    prisma.subscription.findMany({
      where: { userId, status: "stale" },
      include: { merchant: true },
      orderBy: { lastCharged: "asc" },
    }),
  ]);

  const subs = subscriptions.map((s) => ({
    id: s.id,
    name: s.merchant.normalizedName,
    category: s.merchant.category,
    amount: Number(s.amount),
    cadence: s.cadence,
    lastCharged: s.lastCharged,
    monthly: monthlyCost(Number(s.amount), s.cadence),
  }));

  const monthlyTotal = subs.reduce((sum, s) => sum + s.monthly, 0);
  const breakdown = categoryBreakdown(subs);

  const mostExpensive =
    subs.length > 0
      ? subs.reduce((max, s) => (s.monthly > max.monthly ? s : max))
      : null;

  // Duplicate warnings: any category with 2+ active subscriptions.
  const byCategory = new Map<string, typeof subs>();
  for (const s of subs) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }
  const duplicateWarnings: DuplicateWarning[] = [];
  for (const [category, list] of byCategory) {
    if (list.length >= 2) {
      duplicateWarnings.push({
        category,
        names: list.map((s) => s.name),
        monthlyTotal: list.reduce((sum, s) => sum + s.monthly, 0),
      });
    }
  }
  duplicateWarnings.sort((a, b) => b.monthlyTotal - a.monthlyTotal);

  // Subscriptions already retired as stale — no charge in 2x their cadence.
  const staleSubscriptions: StaleSubscription[] = staleRows.map((s) => ({
    id: s.id,
    name: s.merchant.normalizedName,
    lastCharged: s.lastCharged,
    amount: Number(s.amount),
    cadence: s.cadence,
  }));

  return {
    monthlyTotal,
    yearlyTotal: monthlyTotal * 12,
    activeCount: subs.length,
    topCategory: breakdown[0] ?? null,
    mostExpensive: mostExpensive
      ? { name: mostExpensive.name, monthly: mostExpensive.monthly }
      : null,
    categoryBreakdown: breakdown,
    duplicateWarnings,
    staleSubscriptions,
  };
}

/** Compact text summary of the stats, used as the prompt input for the AI narrative. */
export function statsSummary(stats: InsightStats): string {
  const lines = [
    `Active subscriptions: ${stats.activeCount}`,
    `Total monthly spend: $${stats.monthlyTotal.toFixed(2)}`,
    `Total yearly spend: $${stats.yearlyTotal.toFixed(2)}`,
    stats.topCategory
      ? `Top category: ${stats.topCategory.category} ($${stats.topCategory.amount.toFixed(2)}/mo)`
      : "",
    stats.mostExpensive
      ? `Most expensive: ${stats.mostExpensive.name} ($${stats.mostExpensive.monthly.toFixed(2)}/mo)`
      : "",
    `Spend by category: ${stats.categoryBreakdown
      .map((c) => `${c.category} $${c.amount.toFixed(2)}`)
      .join(", ")}`,
    stats.duplicateWarnings.length
      ? `Overlapping services: ${stats.duplicateWarnings
          .map((w) => `${w.category} (${w.names.join(", ")})`)
          .join("; ")}`
      : "",
    stats.staleSubscriptions.length
      ? `Possibly unused (no recent charge): ${stats.staleSubscriptions
          .map((s) => s.name)
          .join(", ")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}
