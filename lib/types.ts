// Shared domain types — see docs/HLD.md

/** How a bank CSV encodes spend vs. income in its amount column. */
export type AmountSign = "negative_is_spend" | "positive_is_spend";

/** Result of the Gemini column-mapping call for an uploaded CSV. */
export interface ColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  amountSign: AmountSign;
  bankGuess: string | null;
}

/** A single transaction after parsing + normalization, source-agnostic. */
export interface NormalizedTransaction {
  date: Date;
  amount: number; // always positive; represents money spent
  rawDescription: string;
}

/**
 * A source of transactions (CSV today; Plaid/Teller later).
 * Implementations turn some raw input into normalized, spend-only transactions.
 */
export interface TransactionSource {
  parse(): Promise<NormalizedTransaction[]>;
}

export type SubscriptionCadence = "weekly" | "monthly" | "yearly";

/** Gemini's analysis of one merchant (cached in the Merchant table). */
export interface MerchantAnalysis {
  rawPattern: string;
  normalizedName: string;
  description: string;
  category: string;
  isSubscription: boolean;
}
