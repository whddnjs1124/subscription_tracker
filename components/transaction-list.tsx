import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui";

export interface TxRow {
  id: string;
  date: Date;
  rawDescription: string;
  amount: number;
  merchantName: string | null;
  isSubscription: boolean;
}

export function TransactionList({ items }: { items: TxRow[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No transactions imported yet.
      </p>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((t) => {
          const name = t.merchantName ?? t.rawDescription;
          const showRaw = t.merchantName && t.merchantName !== t.rawDescription;
          return (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{name}</span>
                  {t.isSubscription && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                      subscription
                    </span>
                  )}
                </div>
                {showRaw && (
                  <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {t.rawDescription}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular-nums text-sm font-medium">
                  {formatCurrency(t.amount)}
                </div>
                <div className="text-xs text-zinc-400">{formatDate(t.date)}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
