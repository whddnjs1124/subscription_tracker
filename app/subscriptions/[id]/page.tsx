import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { PageHeader, Card, CategoryBadge } from "@/components/ui";
import { SubscriptionActions } from "@/components/subscription-actions";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

interface PriceChange {
  date: Date;
  from: number;
  to: number;
}

/** Detect the points where the charge amount changed over time. */
function priceChanges(
  charges: { date: Date; amount: number }[]
): PriceChange[] {
  const asc = [...charges].sort((a, b) => a.date.getTime() - b.date.getTime());
  const changes: PriceChange[] = [];
  for (let i = 1; i < asc.length; i++) {
    if (Math.abs(asc[i].amount - asc[i - 1].amount) >= 0.01) {
      changes.push({
        date: asc[i].date,
        from: asc[i - 1].amount,
        to: asc[i].amount,
      });
    }
  }
  return changes;
}

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { id } = await params;

  const subscription = await prisma.subscription.findFirst({
    where: { id, userId },
    include: {
      merchant: {
        include: {
          transactions: {
            where: { userId },
            orderBy: { date: "desc" },
          },
        },
      },
    },
  });

  if (!subscription) notFound();

  const { merchant } = subscription;
  const charges = merchant.transactions.map((t) => ({
    id: t.id,
    date: t.date,
    amount: Number(t.amount),
  }));
  const changes = priceChanges(charges);
  const latestIncrease = changes.filter((c) => c.to > c.from).at(-1);

  const statusStyle: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    cancelled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    rejected: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← Back to dashboard
      </Link>

      <PageHeader
        title={merchant.normalizedName}
        subtitle={merchant.description}
        action={
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
              statusStyle[subscription.status] ?? statusStyle.cancelled
            }`}
          >
            {subscription.status}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-zinc-400">Amount</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatCurrency(Number(subscription.amount))}
            <span className="text-xs font-normal text-zinc-400">
              /{subscription.cadence.replace("ly", "")}
            </span>
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-zinc-400">Category</p>
          <p className="mt-2">
            <CategoryBadge category={merchant.category} />
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-zinc-400">
            Next billing
          </p>
          <p className="mt-1 text-sm font-medium">
            {formatDate(subscription.nextBillingEstimate)}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-zinc-400">
            First seen
          </p>
          <p className="mt-1 text-sm font-medium">
            {formatDate(subscription.firstSeen)}
          </p>
        </Card>
      </div>

      {latestIncrease && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Price increased from {formatCurrency(latestIncrease.from)} to{" "}
          {formatCurrency(latestIncrease.to)} on{" "}
          {formatDate(latestIncrease.date)}.
        </div>
      )}

      {subscription.note && (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Note: {subscription.note}
        </p>
      )}

      <div className="mt-6">
        <SubscriptionActions
          id={subscription.id}
          status={subscription.status}
          name={merchant.normalizedName}
          note={subscription.note}
        />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          Payment history ({charges.length})
        </h2>
        <Card>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {charges.map((c) => {
              const change = changes.find(
                (ch) => ch.date.getTime() === c.date.getTime()
              );
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-2.5 text-sm first:pt-0 last:pb-0"
                >
                  <span className="text-zinc-500">{formatDate(c.date)}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {change && (
                      <span
                        className={`text-xs ${
                          change.to > change.from
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {change.to > change.from ? "↑" : "↓"} from{" "}
                        {formatCurrency(change.from)}
                      </span>
                    )}
                    <span className="font-medium">{formatCurrency(c.amount)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
