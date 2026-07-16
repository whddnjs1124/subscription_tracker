import { prisma } from "@/lib/db";
import { PageHeader, StatCard, Card, EmptyState, CategoryBadge } from "@/components/ui";
import { InsightNarrative } from "@/components/insight-narrative";
import { computeInsights } from "@/lib/insights";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function InsightsPage() {
  const stats = await computeInsights();

  if (stats.activeCount === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Insights"
          subtitle="AI-generated analysis of your subscription spending."
        />
        <EmptyState
          title="Nothing to analyze yet"
          description="Import a statement and detect some subscriptions first — insights will appear here."
          actionHref="/upload"
          actionLabel="Upload a statement"
        />
      </div>
    );
  }

  const cached = await prisma.insight.findUnique({
    where: { month: monthKey() },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Insights"
        subtitle="A read on your recurring spending."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Monthly total" value={formatCurrency(stats.monthlyTotal)} />
        <StatCard label="Yearly total" value={formatCurrency(stats.yearlyTotal)} />
        <StatCard label="Active" value={String(stats.activeCount)} />
        <StatCard
          label="Most expensive"
          value={
            stats.mostExpensive
              ? formatCurrency(stats.mostExpensive.monthly)
              : "—"
          }
          hint={stats.mostExpensive?.name}
        />
      </div>

      <div className="mt-6">
        <InsightNarrative initial={cached?.content ?? null} />
      </div>

      {stats.duplicateWarnings.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            Overlapping services
          </h2>
          <div className="flex flex-col gap-2">
            {stats.duplicateWarnings.map((w) => (
              <Card key={w.category}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <CategoryBadge category={w.category} />
                      <span className="text-sm font-medium">
                        {w.names.length} services
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {w.names.join(", ")}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums font-medium">
                    {formatCurrency(w.monthlyTotal)}
                    <span className="text-xs text-zinc-400">/mo</span>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {stats.staleSubscriptions.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            Possibly unused
          </h2>
          <div className="flex flex-col gap-2">
            {stats.staleSubscriptions.map((s) => (
              <Card key={s.id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    last charged {formatDate(s.lastCharged)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
