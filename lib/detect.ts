import { prisma } from "@/lib/db";
import { detectRecurring, nextBilling } from "@/lib/detection";
import { analyzeMerchants } from "@/lib/gemini";
import type { MerchantAnalysis } from "@/lib/types";

export interface DetectedSubscription {
  id: string;
  name: string;
  description: string;
  category: string;
  amount: number;
  cadence: string;
  nextBillingEstimate: string;
  isNew: boolean;
}

export interface DetectionSummary {
  candidates: number;
  merchantsAnalyzed: number; // new merchants sent to Gemini this run
  subscriptions: DetectedSubscription[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Full detection pass (docs/HLD.md §3.2–3.3), idempotent across all stored
 * transactions. Rules engine -> Gemini merchant analysis (cached) -> link
 * transactions -> create/update Subscription rows (respecting user rejections).
 */
export async function detectSubscriptions(): Promise<DetectionSummary> {
  const transactions = await prisma.transaction.findMany({
    select: { id: true, date: true, amount: true, rawDescription: true },
  });

  const candidates = detectRecurring(
    transactions.map((t) => ({
      id: t.id,
      date: t.date,
      amount: Number(t.amount),
      rawDescription: t.rawDescription,
    }))
  );

  if (candidates.length === 0) {
    return { candidates: 0, merchantsAnalyzed: 0, subscriptions: [] };
  }

  // --- Merchant cache: reuse existing analyses, only ask Gemini about new keys.
  const keys = candidates.map((c) => c.key);
  const existingMerchants = await prisma.merchant.findMany({
    where: { rawPattern: { in: keys } },
  });
  const merchantByKey = new Map(existingMerchants.map((m) => [m.rawPattern, m]));

  const unanalyzed = candidates.filter((c) => !merchantByKey.has(c.key));
  let merchantsAnalyzed = 0;

  if (unanalyzed.length > 0) {
    const analyses: MerchantAnalysis[] = await analyzeMerchants(
      unanalyzed.map((c) => ({
        key: c.key,
        sampleDescription: c.sampleDescription,
        amount: c.amount,
        cadence: c.cadence,
      }))
    );
    const analysisByKey = new Map(analyses.map((a) => [a.rawPattern, a]));

    for (const cand of unanalyzed) {
      const a = analysisByKey.get(cand.key);
      if (!a) continue; // analysis failed for this merchant; leave unanalyzed
      const merchant = await prisma.merchant.create({
        data: {
          rawPattern: cand.key,
          normalizedName: a.normalizedName,
          description: a.description,
          category: a.category,
          isSubscriptionService: a.isSubscription,
        },
      });
      merchantByKey.set(cand.key, merchant);
      merchantsAnalyzed++;
    }
  }

  // --- Link transactions in each candidate group to their merchant.
  for (const cand of candidates) {
    const merchant = merchantByKey.get(cand.key);
    if (!merchant) continue;
    for (const group of chunk(cand.transactionIds, 400)) {
      await prisma.transaction.updateMany({
        where: { id: { in: group } },
        data: { merchantId: merchant.id },
      });
    }
  }

  // --- Create/update Subscription rows for genuine subscription merchants.
  const result: DetectedSubscription[] = [];

  for (const cand of candidates) {
    const merchant = merchantByKey.get(cand.key);
    if (!merchant || !merchant.isSubscriptionService) continue;

    const nextEstimate = nextBilling(cand.lastCharged, cand.cadence);
    const existing = await prisma.subscription.findFirst({
      where: { merchantId: merchant.id, isManual: false },
    });

    if (existing) {
      if (existing.status === "rejected") continue; // respect user's decision
      const updated = await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          amount: cand.amount,
          cadence: cand.cadence,
          firstSeen:
            cand.firstSeen < existing.firstSeen
              ? cand.firstSeen
              : existing.firstSeen,
          lastCharged: cand.lastCharged,
          nextBillingEstimate: nextEstimate,
        },
      });
      result.push(toDetected(updated.id, merchant, cand, nextEstimate, false));
    } else {
      const created = await prisma.subscription.create({
        data: {
          merchantId: merchant.id,
          amount: cand.amount,
          cadence: cand.cadence,
          firstSeen: cand.firstSeen,
          lastCharged: cand.lastCharged,
          nextBillingEstimate: nextEstimate,
          status: "active",
        },
      });
      result.push(toDetected(created.id, merchant, cand, nextEstimate, true));
    }
  }

  result.sort(
    (a, b) =>
      new Date(a.nextBillingEstimate).getTime() -
      new Date(b.nextBillingEstimate).getTime()
  );

  return {
    candidates: candidates.length,
    merchantsAnalyzed,
    subscriptions: result,
  };
}

function toDetected(
  id: string,
  merchant: { normalizedName: string; description: string; category: string },
  cand: { amount: number; cadence: string },
  nextEstimate: Date,
  isNew: boolean
): DetectedSubscription {
  return {
    id,
    name: merchant.normalizedName,
    description: merchant.description,
    category: merchant.category,
    amount: cand.amount,
    cadence: cand.cadence,
    nextBillingEstimate: nextEstimate.toISOString(),
    isNew,
  };
}
