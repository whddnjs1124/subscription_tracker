import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, StatCard, EmptyState, Card } from "@/components/ui";
import { TransactionList } from "@/components/transaction-list";
import { TransactionFilters } from "@/components/transaction-filters";
import { ResetButton } from "@/components/reset-button";
import { getUserId } from "@/lib/session";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface SearchParams {
  q?: string;
  category?: string;
  month?: string;
  page?: string;
}

/** "2026-07" -> [2026-07-01, 2026-08-01). Returns null if unparseable. */
function monthRange(month: string): { gte: Date; lt: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return {
    gte: new Date(Date.UTC(year, mon - 1, 1)),
    lt: new Date(Date.UTC(year, mon, 1)),
  };
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { q, category, month, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const range = month ? monthRange(month) : null;

  const where: Prisma.TransactionWhereInput = {
    userId,
    ...(q
      ? {
          OR: [
            { rawDescription: { contains: q, mode: "insensitive" as const } },
            {
              merchant: {
                normalizedName: { contains: q, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
    ...(category ? { merchant: { category } } : {}),
    ...(range ? { date: range } : {}),
  };

  const [totalCount, unfilteredCount, sum, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    // Distinguishes "you have no data" from "your filters matched nothing".
    prisma.transaction.count({ where: { userId } }),
    prisma.transaction.aggregate({ where, _sum: { amount: true } }),
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        merchant: {
          select: { normalizedName: true, isSubscriptionService: true },
        },
      },
    }),
  ]);

  if (unfilteredCount === 0) {
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

  const total = Number(sum._sum.amount ?? 0);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (month) sp.set("month", month);
    if (n > 1) sp.set("page", String(n));
    return sp.size ? `/transactions?${sp}` : "/transactions";
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Transactions"
        subtitle="Every expense imported from your statements."
        action={<ResetButton />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4">
        <StatCard label="Transactions" value={String(totalCount)} />
        <StatCard label="Total spend" value={formatCurrency(total)} accent />
      </div>

      <TransactionFilters />

      {totalCount === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No transactions match your filters.{" "}
            <Link
              href="/transactions"
              className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              Clear filters
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <TransactionList items={items} />

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-zinc-400">
                Page {Math.min(page, pageCount)} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
