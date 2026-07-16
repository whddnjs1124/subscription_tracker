// Client-safe category list (no server-only imports), shared by the UI and by
// lib/gemini.ts for the merchant-analysis schema.
export const MERCHANT_CATEGORIES = [
  "entertainment",
  "utilities",
  "software",
  "telecom",
  "news",
  "fitness",
  "food",
  "finance",
  "other",
] as const;

export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

/** CSS variable for a category's chart color (defined in globals.css). */
export function categoryColor(category: string): string {
  const key = category.toLowerCase();
  const known = (MERCHANT_CATEGORIES as readonly string[]).includes(key)
    ? key
    : "other";
  return `var(--cat-${known})`;
}
