import Papa from "papaparse";
import type {
  ColumnMapping,
  NormalizedTransaction,
  TransactionSource,
} from "@/lib/types";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parse raw CSV text into headers + row objects keyed by header. */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

/**
 * Best-effort column mapping from header names alone, used as a fallback when
 * the Gemini mapping call is unavailable (e.g. rate-limited). Returns null if it
 * cannot confidently find all three columns.
 */
export function heuristicMapping(
  headers: string[],
  sampleRows: Record<string, string>[]
): ColumnMapping | null {
  const find = (re: RegExp) => headers.find((h) => re.test(h));

  const dateColumn =
    headers.find((h) => /^(transaction\s*)?date$/i.test(h.trim())) ??
    find(/date/i);
  const descriptionColumn = find(/desc|memo|name|payee|merchant|detail/i);
  const amountColumn = find(/amount|debit/i);

  if (!dateColumn || !descriptionColumn || !amountColumn) return null;

  // Infer the sign convention from the sample: any negative value means
  // debits are encoded as negatives.
  const anyNegative = sampleRows.some((r) => {
    const n = parseAmount(r[amountColumn] ?? "");
    return n !== null && n < 0;
  });

  return {
    dateColumn,
    descriptionColumn,
    amountColumn,
    amountSign: anyNegative ? "negative_is_spend" : "positive_is_spend",
    bankGuess: null,
  };
}

/** Parse a US-style date string (MM/DD/YYYY, YYYY-MM-DD, etc.). */
export function parseDate(value: string): Date | null {
  const s = value.trim();
  if (!s) return null;

  // MM/DD/YYYY or MM-DD-YYYY
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    );
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** Parse a currency string like "$1,234.56", "-12.99", or "(12.99)". */
export function parseAmount(value: string): number | null {
  let s = value.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  const n = Number(s);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Turn CSV rows into normalized, spend-only transactions using a column mapping.
 * Deposits/credits (income) are dropped; spend is stored as a positive number.
 */
export function normalizeRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): NormalizedTransaction[] {
  const out: NormalizedTransaction[] = [];

  for (const row of rows) {
    const date = parseDate(row[mapping.dateColumn] ?? "");
    const rawAmount = parseAmount(row[mapping.amountColumn] ?? "");
    const rawDescription = (row[mapping.descriptionColumn] ?? "").trim();

    if (!date || rawAmount === null || !rawDescription) continue;

    // Convert to "spend" magnitude based on the bank's sign convention.
    const spend =
      mapping.amountSign === "negative_is_spend" ? -rawAmount : rawAmount;

    // Keep only outgoing money (spend > 0); ignore deposits/refunds.
    if (spend <= 0) continue;

    out.push({ date, amount: spend, rawDescription });
  }

  return out;
}

/** CSV implementation of the TransactionSource abstraction (docs/HLD.md §7). */
export class CsvTransactionSource implements TransactionSource {
  constructor(
    private readonly csvText: string,
    private readonly mapping: ColumnMapping
  ) {}

  async parse(): Promise<NormalizedTransaction[]> {
    const { rows } = parseCsv(this.csvText);
    return normalizeRows(rows, this.mapping);
  }
}
