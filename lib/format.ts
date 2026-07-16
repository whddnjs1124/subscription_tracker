export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  // Transaction dates are stored as UTC midnight (date-only). Format in UTC so
  // they don't shift a day in timezones behind UTC.
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

const CADENCE_MONTHLY_FACTOR: Record<string, number> = {
  weekly: 52 / 12,
  monthly: 1,
  yearly: 1 / 12,
};

/** Normalize a subscription charge to its average monthly cost. */
export function monthlyCost(amount: number, cadence: string): number {
  return amount * (CADENCE_MONTHLY_FACTOR[cadence] ?? 1);
}
