"use client";

import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { categoryColor } from "@/lib/categories";
import { formatCurrency } from "@/lib/format";

interface CategoryDatum {
  category: string;
  amount: number;
}

function TooltipBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-medium capitalize">{label}</p>
      <p className="tabular-nums text-zinc-500 dark:text-zinc-400">{value}</p>
    </div>
  );
}

export function CategoryDonut({ data }: { data: CategoryDatum[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (total === 0) {
    return <p className="text-sm text-zinc-500">No spending to chart yet.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="category"
              innerRadius={42}
              outerRadius={68}
              paddingAngle={2}
              stroke="var(--surface-ring, transparent)"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.category} fill={categoryColor(d.category)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload && payload.length ? (
                  <TooltipBox
                    label={String(payload[0].name)}
                    value={`${formatCurrency(
                      Number(payload[0].value)
                    )}/mo · ${Math.round(
                      (Number(payload[0].value) / total) * 100
                    )}%`}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full flex-1 space-y-2 self-stretch">
        {data.map((d) => (
          <li
            key={d.category}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ background: categoryColor(d.category) }}
              />
              <span className="truncate capitalize">{d.category}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatCurrency(d.amount)}
              <span className="ml-1 text-xs text-zinc-400">
                {Math.round((d.amount / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TrendDatum {
  month: string; // "Mar", "Apr", ...
  amount: number;
}

export function MonthlyTrend({ data }: { data: TrendDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No history to chart yet.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <XAxis
            dataKey="month"
            tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-grid)" }}
          />
          <YAxis
            width={48}
            tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload && payload.length ? (
                <TooltipBox
                  label={String(label)}
                  value={formatCurrency(Number(payload[0].value))}
                />
              ) : null
            }
          />
          <Line
            type="monotone"
            dataKey="amount"
            stroke="var(--chart-line)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--chart-line)", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
