import { prisma } from "@/lib/db";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { TransactionList } from "@/components/transaction-list";
import { ResetButton } from "@/components/reset-button";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const transactions = await prisma.transaction.findMany({
    orderBy: { date: "desc" },
    include: {
      merchant: { select: { normalizedName: true, isSubscriptionService: true } },
    },
  });

  if (transactions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Transactions"
          subtitle="Every expense imported from your statements."
        />
        <EmptyState
          title="No transactions yet"
          description="Upload a bank CSV or PDF statement and every expense will be listed here."
          actionHref="/upload"
          actionLabel="Upload a statement"
        />
      </div>
    );
  }

  const items = transactions.map((t) => ({
    id: t.id,
    date: t.date,
    rawDescription: t.rawDescription,
    amount: Number(t.amount),
    merchantName: t.merchant?.normalizedName ?? null,
    isSubscription: t.merchant?.isSubscriptionService ?? false,
  }));

  const total = items.reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Transactions"
        subtitle="Every expense imported from your statements."
        action={<ResetButton />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4">
        <StatCard label="Transactions" value={String(items.length)} />
        <StatCard label="Total spend" value={formatCurrency(total)} />
      </div>

      <TransactionList items={items} />
    </div>
  );
}
