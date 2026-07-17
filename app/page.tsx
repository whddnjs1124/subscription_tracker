import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { PageHeader, StatCard, EmptyState, Card, CategoryBadge } from "@/components/ui";
import { CategoryDonut, MonthlyTrend } from "@/components/charts";
import { TransactionList } from "@/components/transaction-list";
import { ResetButton } from "@/components/reset-button";
import { RerunDetection } from "@/components/rerun-detection";
import { formatCurrency, formatDate, monthlyCost } from "@/lib/format";
import { categoryBreakdown, monthlyTrend } from "@/lib/analytics";
import { applyStaleStatus } from "@/lib/lifecycle";
import { groupUpcoming, daysUntil, RENEWAL_WINDOW_DAYS } from "@/lib/renewals";

export const dynamic = "force-dynamic";

const DUE_SOON_DAYS = 7;

export default async function DashboardPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  // Retire subscriptions that stopped being charged before reading the totals,
  // so a user who never re-uploads still sees honest numbers.
  await applyStaleStatus(userId);

  const [subscriptions, transactions, staleCount, unlabeledCount] =
    await Promise.all([
      prisma.subscription.findMany({
        where: { userId, status: "active" },
        include: { merchant: true },
        orderBy: { nextBillingEstimate: "asc" },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        include: {
          merchant: {
            select: { normalizedName: true, isSubscriptionService: true },
          },
        },
      }),
      prisma.subscription.count({ where: { userId, status: "stale" } }),
      prisma.transaction.count({ where: { userId, merchantId: null } }),
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
  const renewals = groupUpcoming(subs);

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

  // Reading the clock is what makes this page dynamic; it re-renders per
  // request (force-dynamic), so there is no cached output to go stale.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  // "Due soon" means soon, not "at some point in the past": a negative distance
  // is overdue and gets its own badge.
  const dueSoon = (d: Date) =>
    daysUntil(d, now) >= 0 && daysUntil(d, now) <= DUE_SOON_DAYS;
  const overdue = (d: Date) => daysUntil(d, now) < 0;

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
          accent
        />
        <StatCard label="Active subscriptions" value={String(subs.length)} />
        <StatCard
          label="Yearly projection"
          value={formatCurrency(monthlyTotal * 12)}
        />
        <StatCard
          label={`Due in next ${RENEWAL_WINDOW_DAYS} days`}
          value={formatCurrency(renewals.total)}
          hint={`${renewals.count} renewal${renewals.count === 1 ? "" : "s"}`}
        />
      </div>

      {(staleCount > 0 || unlabeledCount > 0) && (
        <div className="mt-6 flex flex-col gap-3">
          {staleCount > 0 && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-500/10">
              <p className="text-amber-800 dark:text-amber-300">
                <strong>{staleCount}</strong> subscription
                {staleCount === 1 ? "" : "s"} stopped being charged and{" "}
                {staleCount === 1 ? "is" : "are"} no longer counted in your
                totals.
              </p>
              <Link
                href="/subscriptions?status=stale"
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-800 dark:bg-transparent dark:text-amber-400 dark:hover:bg-amber-500/10"
              >
                Review
              </Link>
            </div>
          )}
          {unlabeledCount > 0 && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-500/10">
              <p className="text-amber-800 dark:text-amber-300">
                <strong>{unlabeledCount}</strong> transaction
                {unlabeledCount === 1 ? "" : "s"} haven&apos;t been analyzed by
                the AI yet, so subscriptions among them are still undetected.
              </p>
              <RerunDetection />
            </div>
          )}
        </div>
      )}

      {subs.length === 0 ? (
        transactions.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No subscriptions yet"
              description="Upload a bank statement (CSV or PDF) and Subscription Tracker will detect your recurring subscriptions automatically."
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

          {renewals.groups.length > 0 && (
            <div className="mt-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  Upcoming renewals
                </h2>
                <span className="text-xs text-zinc-400">
                  {formatCurrency(renewals.total)} over {RENEWAL_WINDOW_DAYS}{" "}
                  days
                </span>
              </div>
              <div className="flex flex-col gap-4">
                {renewals.groups.map((group) => (
                  <div key={group.label}>
                    <h3 className="mb-2 text-xs font-medium text-zinc-400">
                      {group.label}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {group.items.map((s) => (
                        <Link key={s.id} href={`/subscriptions/${s.id}`}>
                          <Card className="py-3 transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-700">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium">
                                  {s.name}
                                </span>
                                <CategoryBadge category={s.category} />
                              </div>
                              <div className="flex shrink-0 items-center gap-4">
                                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                                  {formatDate(s.nextBillingEstimate)}
                                </span>
                                <span className="tabular-nums font-medium">
                                  {formatCurrency(s.amount)}
                                </span>
                              </div>
                            </div>
                          </Card>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Active subscriptions
            </h2>
            <div className="flex flex-col gap-2">
              {subs.map((s) => (
                <Link key={s.id} href={`/subscriptions/${s.id}`}>
                  <Card className="transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-700">
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
                          {overdue(s.nextBillingEstimate) && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                              overdue
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
