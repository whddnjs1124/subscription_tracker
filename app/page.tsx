import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, StatCard, EmptyState, Card, CategoryBadge } from "@/components/ui";
import { CategoryDonut, MonthlyTrend } from "@/components/charts";
import { TransactionList } from "@/components/transaction-list";
import { ResetButton } from "@/components/reset-button";
import { formatCurrency, formatDate, monthlyCost } from "@/lib/format";
import { categoryBreakdown, monthlyTrend } from "@/lib/analytics";

export const dynamic = "force-dynamic";

const DUE_SOON_DAYS = 7;

export default async function DashboardPage() {
  const [subscriptions, transactions] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: "active" },
      include: { merchant: true },
      orderBy: { nextBillingEstimate: "asc" },
    }),
    prisma.transaction.findMany({
      orderBy: { date: "desc" },
      include: {
        merchant: {
          select: { normalizedName: true, isSubscriptionService: true },
        },
      },
    }),
  ]);

  const subs = subscriptions.map((s) => ({
    id: s.id,
    name: s.merchant.normalizedName,
    description: s.merchant.description,
    category: s.merchant.category,
    amount: Number(s.amount),
    cadence: s.cadence,
    nextBillingEstimate: s.nextBillingEstimate,
  }));

  const monthlyTotal = subs.reduce(
    (sum, s) => sum + monthlyCost(s.amount, s.cadence),
    0
  );
  const categories = new Set(subs.map((s) => s.category)).size;

  const donutData = categoryBreakdown(subs);
  const trendData = monthlyTrend(
    transactions.map((t) => ({
      date: t.date,
      amount: Number(t.amount),
      isSubscription: t.merchant?.isSubscriptionService ?? false,
    }))
  );

  const recentTx = transactions.slice(0, 8).map((t) => ({
    id: t.id,
    date: t.date,
    rawDescription: t.rawDescription,
    amount: Number(t.amount),
    merchantName: t.merchant?.normalizedName ?? null,
    isSubscription: t.merchant?.isSubscriptionService ?? false,
  }));

  const now = Date.now();
  const dueSoon = (d: Date) =>
    (d.getTime() - now) / (24 * 60 * 60 * 1000) <= DUE_SOON_DAYS;

  const viewAllLink = (
    <Link
      href="/transactions"
      className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
    >
      View all {transactions.length} →
    </Link>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Dashboard"
        subtitle="Your recurring subscriptions at a glance."
        action={
          <div className="flex items-center gap-3">
            {(subscriptions.length > 0 || transactions.length > 0) && (
              <ResetButton />
            )}
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Upload statement
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Monthly total"
          value={formatCurrency(monthlyTotal)}
          hint="Across all active subscriptions"
        />
        <StatCard label="Active subscriptions" value={String(subs.length)} />
        <StatCard
          label="Yearly projection"
          value={formatCurrency(monthlyTotal * 12)}
        />
        <StatCard label="Categories" value={String(categories)} />
      </div>

      {subs.length === 0 ? (
        transactions.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No subscriptions yet"
              description="Upload a bank statement (CSV or PDF) and Sub Tracker will detect your recurring subscriptions automatically."
              actionHref="/upload"
              actionLabel="Upload your first statement"
            />
          </div>
        ) : (
          <div className="mt-8">
            <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              Imported <strong>{transactions.length}</strong> transactions, but no
              recurring subscriptions detected yet. Subscriptions show up when the
              same charge repeats across months — try uploading a few months of
              statements. Your imported expenses are listed below.
            </div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Imported transactions
              </h2>
              {viewAllLink}
            </div>
            <TransactionList items={recentTx} />
          </div>
        )
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Spend by category
              </h2>
              <CategoryDonut data={donutData} />
            </Card>
            <Card>
              <h2 className="mb-4 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Monthly subscription spend
              </h2>
              <MonthlyTrend data={trendData} />
            </Card>
          </div>

          <div className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Active subscriptions
            </h2>
            <div className="flex flex-col gap-2">
              {subs.map((s) => (
                <Link key={s.id} href={`/subscriptions/${s.id}`}>
                  <Card className="transition-colors hover:border-emerald-300 dark:hover:border-emerald-700">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          <CategoryBadge category={s.category} />
                          {dueSoon(s.nextBillingEstimate) && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                              due soon
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                          {s.description} · next {formatDate(s.nextBillingEstimate)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tabular-nums font-medium">
                          {formatCurrency(s.amount)}
                        </div>
                        <div className="text-xs text-zinc-400">
                          per {s.cadence.replace("ly", "")}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Recent transactions
              </h2>
              {viewAllLink}
            </div>
            <TransactionList items={recentTx} />
          </div>
        </>
      )}
    </div>
  );
}
