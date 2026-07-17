import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { applyStaleStatus } from "@/lib/lifecycle";
import { PageHeader, Card, CategoryBadge, StatusBadge, EmptyState } from "@/components/ui";
import { ReactivateButton } from "@/components/subscription-quick-actions";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS = [
  { status: "active", label: "Active" },
  { status: "stale", label: "Inactive" },
  { status: "cancelled", label: "Cancelled" },
  { status: "rejected", label: "Rejected" },
] as const;

const VALID = new Set(TABS.map((t) => t.status as string));

const BLURB: Record<string, string> = {
  active: "Subscriptions currently being charged. These make up your totals.",
  stale:
    "No charge in twice their billing cycle, so they no longer count toward your totals. Reactivate any that are still running.",
  cancelled: "You marked these as cancelled.",
  rejected: "You said these aren't subscriptions, so detection leaves them alone.",
};

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  await applyStaleStatus(userId);

  const { status: rawStatus } = await searchParams;
  const status = rawStatus && VALID.has(rawStatus) ? rawStatus : "active";

  const [subscriptions, grouped] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId, status },
      include: { merchant: true },
      orderBy:
        status === "active"
          ? { nextBillingEstimate: "asc" }
          : { lastCharged: "desc" },
    }),
    prisma.subscription.groupBy({
      by: ["status"],
      where: { userId },
      _count: true,
    }),
  ]);

  const countFor = (s: string) =>
    grouped.find((g) => g.status === s)?._count ?? 0;
  const totalAll = grouped.reduce((sum, g) => sum + g._count, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Subscriptions"
        subtitle="Every subscription we've detected, by status."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = tab.status === status;
          return (
            <Link
              key={tab.status}
              href={`/subscriptions?status=${tab.status}`}
              className={[
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900",
              ].join(" ")}
            >
              {tab.label}
              <span className={active ? "ml-1.5 opacity-80" : "ml-1.5 text-zinc-400"}>
                {countFor(tab.status)}
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        {BLURB[status]}
      </p>

      {subscriptions.length === 0 ? (
        totalAll === 0 ? (
          <EmptyState
            title="No subscriptions yet"
            description="Upload a bank statement and Subscription Tracker will detect your recurring subscriptions automatically."
            actionHref="/upload"
            actionLabel="Upload a statement"
          />
        ) : (
          <Card>
            <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Nothing here.
            </p>
          </Card>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {subscriptions.map((s) => (
            <Link key={s.id} href={`/subscriptions/${s.id}`}>
              <Card className="transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-700">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {s.merchant.normalizedName}
                      </span>
                      <CategoryBadge category={s.merchant.category} />
                      {status !== "active" && <StatusBadge status={s.status} />}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {s.status === "active"
                        ? `next ${formatDate(s.nextBillingEstimate)}`
                        : `last charged ${formatDate(s.lastCharged)}`}
                      {s.userEdited && " · edited manually"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="tabular-nums font-medium">
                        {formatCurrency(Number(s.amount))}
                      </div>
                      <div className="text-xs text-zinc-400">
                        per {s.cadence.replace("ly", "")}
                      </div>
                    </div>
                    {status !== "active" && <ReactivateButton id={s.id} />}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
