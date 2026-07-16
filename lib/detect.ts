import { prisma } from "@/lib/db";
import { detectRecurring, nextBilling, merchantKey } from "@/lib/detection";
import { analyzeMerchants } from "@/lib/gemini";
import type { MerchantAnalysis, SubscriptionCadence } from "@/lib/types";

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

// A stored Merchant row, as returned by Prisma.
type MerchantRow = {
  id: string;
  normalizedName: string;
  description: string;
  category: string;
  isSubscriptionService: boolean;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface KeyGroup {
  key: string;
  sampleDescription: string;
  amount: number; // representative (most-recent) amount
  lastDate: number;
  occurrences: number;
  transactionIds: string[];
}

/**
 * Stage A: name and classify EVERY unique merchant on record (not just recurring
 * ones) so all imported transactions get a clean name and description. New
 * merchants are batched to Gemini and cached in the Merchant table; already-known
 * merchants are reused. Every transaction is linked to its merchant. Gemini
 * failures are non-fatal per batch — unlabeled transactions just keep their raw
 * description and can be re-analyzed on the next import.
 */
async function enrichMerchants(
  txs: { id: string; amount: number; rawDescription: string; date: Date }[],
  cadenceByKey: Map<string, SubscriptionCadence>
): Promise<{ merchantsAnalyzed: number; merchantByKey: Map<string, MerchantRow> }> {
  const groups = new Map<string, KeyGroup>();
  for (const tx of txs) {
    const key = merchantKey(tx.rawDescription);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        sampleDescription: tx.rawDescription,
        amount: tx.amount,
        lastDate: tx.date.getTime(),
        occurrences: 0,
        transactionIds: [],
      };
      groups.set(key, g);
    }
    g.occurrences++;
    g.transactionIds.push(tx.id);
    if (tx.date.getTime() >= g.lastDate) {
      g.lastDate = tx.date.getTime();
      g.amount = tx.amount;
      g.sampleDescription = tx.rawDescription;
    }
  }

  const keys = [...groups.keys()];
  const existing = await prisma.merchant.findMany({
    where: { rawPattern: { in: keys } },
  });
  const merchantByKey = new Map<string, MerchantRow>(
    existing.map((m) => [m.rawPattern, m])
  );
  const missing = keys.filter((k) => !merchantByKey.has(k));

  let merchantsAnalyzed = 0;
  for (const batch of chunk(missing, 40)) {
    let analyses: MerchantAnalysis[];
    try {
      analyses = await analyzeMerchants(
        batch.map((k) => {
          const g = groups.get(k)!;
          return {
            key: k,
            sampleDescription: g.sampleDescription,
            amount: g.amount,
            cadence: cadenceByKey.get(k) ?? "one-time",
            occurrences: g.occurrences,
          };
        })
      );
    } catch {
      // Quota/network failure — skip this batch, leave these merchants unlabeled.
      continue;
    }
    const analysisByKey = new Map(analyses.map((a) => [a.rawPattern, a]));
    for (const k of batch) {
      const a = analysisByKey.get(k);
      if (!a) continue;
      const merchant = await prisma.merchant.create({
        data: {
          rawPattern: k,
          normalizedName: a.normalizedName,
          description: a.description,
          category: a.category,
          isSubscriptionService: a.isSubscription,
        },
      });
      merchantByKey.set(k, merchant);
      merchantsAnalyzed++;
    }
  }

  // Link every transaction to its merchant (idempotent).
  for (const [key, g] of groups) {
    const merchant = merchantByKey.get(key);
    if (!merchant) continue;
    for (const ids of chunk(g.transactionIds, 400)) {
      await prisma.transaction.updateMany({
        where: { id: { in: ids } },
        data: { merchantId: merchant.id },
      });
    }
  }

  return { merchantsAnalyzed, merchantByKey };
}

/**
 * Full detection pass (docs/HLD.md §3.2–3.3), idempotent across all stored
 * transactions. Names/classifies every merchant (Stage A), then the deterministic
 * rules engine finds recurring charges and creates/updates Subscription rows for
 * merchants Gemini judged to be genuine subscriptions (respecting user rejections).
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
  const cadenceByKey = new Map<string, SubscriptionCadence>(
    candidates.map((c) => [c.key, c.cadence])
  );

  // Stage A: name & classify every merchant, link all transactions.
  const { merchantsAnalyzed, merchantByKey } = await enrichMerchants(
    transactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      rawDescription: t.rawDescription,
      date: t.date,
    })),
    cadenceByKey
  );

  // Stage B: create/update Subscription rows for genuine subscription merchants.
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
