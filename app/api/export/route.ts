import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";

export const runtime = "nodejs";

/** Quote a CSV field only when it needs it, doubling any embedded quotes. */
function csvCell(value: string | number | boolean): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | boolean)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Export the signed-in user's data. The app is import-heavy, so being able to
 * take the data back out matters: `?format=csv` gives the transaction ledger,
 * `?format=json` (default) gives subscriptions and transactions together.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const format =
    new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";

  const [subscriptions, transactions] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId },
      include: { merchant: true },
      orderBy: { nextBillingEstimate: "asc" },
    }),
    prisma.transaction.findMany({
      where: { userId },
      include: { merchant: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const stamp = isoDate(new Date());

  if (format === "csv") {
    const csv = toCsv([
      ["date", "description", "merchant", "category", "amount", "isSubscription"],
      ...transactions.map((t) => [
        isoDate(t.date),
        t.rawDescription,
        t.merchant?.normalizedName ?? "",
        t.merchant?.category ?? "",
        Number(t.amount).toFixed(2),
        t.merchant?.isSubscriptionService ?? false,
      ]),
    ]);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sub-tracker-transactions-${stamp}.csv"`,
      },
    });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    subscriptions: subscriptions.map((s) => ({
      name: s.merchant.normalizedName,
      description: s.merchant.description,
      category: s.merchant.category,
      amount: Number(s.amount),
      cadence: s.cadence,
      status: s.status,
      firstSeen: isoDate(s.firstSeen),
      lastCharged: isoDate(s.lastCharged),
      nextBillingEstimate: isoDate(s.nextBillingEstimate),
      isManual: s.isManual,
      userEdited: s.userEdited,
      note: s.note,
    })),
    transactions: transactions.map((t) => ({
      date: isoDate(t.date),
      description: t.rawDescription,
      merchant: t.merchant?.normalizedName ?? null,
      category: t.merchant?.category ?? null,
      amount: Number(t.amount),
      isSubscription: t.merchant?.isSubscriptionService ?? false,
    })),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sub-tracker-export-${stamp}.json"`,
    },
  });
}
