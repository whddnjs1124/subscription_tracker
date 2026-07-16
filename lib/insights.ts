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

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

/**
 * Deterministic subscription insights computed directly from the database —
 * no AI required. The AI narrative (lib/gemini) is layered on top separately.
 */
export async function computeInsights(now = new Date()): Promise<InsightStats> {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
    include: { merchant: true },
  });

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

  // Stale: last charge older than 2x the expected cadence -> maybe unused.
  const staleSubscriptions: StaleSubscription[] = subs
    .filter((s) => {
      const days = (now.getTime() - s.lastCharged.getTime()) / (24 * 3600 * 1000);
      return days > (CADENCE_DAYS[s.cadence] ?? 30) * 2;
    })
    .map((s) => ({
      id: s.id,
      name: s.name,
      lastCharged: s.lastCharged,
      amount: s.amount,
      cadence: s.cadence,
    }))
    .sort((a, b) => a.lastCharged.getTime() - b.lastCharged.getTime());

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
