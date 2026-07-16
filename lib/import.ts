import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { CsvTransactionSource } from "@/lib/sources/csv";
import type { ColumnMapping, NormalizedTransaction } from "@/lib/types";

/** Stable dedupe key so re-uploading the same CSV is a no-op. */
export function dedupeHash(tx: NormalizedTransaction): string {
  const day = tx.date.toISOString().slice(0, 10);
  const key = `${day}|${tx.amount.toFixed(2)}|${tx.rawDescription.toLowerCase()}`;
  return createHash("sha256").update(key).digest("hex");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ImportResult {
  uploadId: string;
  parsed: number; // spend rows found in the file
  imported: number; // newly inserted
  skipped: number; // duplicates (already in DB or repeated in-file)
}

/**
 * Parse + normalize a CSV, then persist new transactions under a new Upload,
 * skipping any that already exist (by dedupeHash). See docs/HLD.md §3.1.
 */
export async function importCsv(
  csvText: string,
  mapping: ColumnMapping,
  fileName: string
): Promise<ImportResult> {
  const source = new CsvTransactionSource(csvText, mapping);
  const transactions = await source.parse();

  // Deduplicate within the file itself first.
  const byHash = new Map<string, NormalizedTransaction>();
  for (const tx of transactions) {
    const h = dedupeHash(tx);
    if (!byHash.has(h)) byHash.set(h, tx);
  }
  const allHashes = [...byHash.keys()];

  // Find which hashes already exist in the DB.
  const existing = new Set<string>();
  for (const group of chunk(allHashes, 400)) {
    const found = await prisma.transaction.findMany({
      where: { dedupeHash: { in: group } },
      select: { dedupeHash: true },
    });
    for (const row of found) existing.add(row.dedupeHash);
  }

  const toInsert = [...byHash.entries()].filter(([h]) => !existing.has(h));

  const upload = await prisma.upload.create({
    data: {
      fileName,
      bankGuess: mapping.bankGuess,
      transactionCount: toInsert.length,
    },
  });

  for (const group of chunk(toInsert, 400)) {
    await prisma.transaction.createMany({
      data: group.map(([h, tx]) => ({
        uploadId: upload.id,
        date: tx.date,
        amount: tx.amount,
        rawDescription: tx.rawDescription,
        dedupeHash: h,
      })),
    });
  }

  return {
    uploadId: upload.id,
    parsed: byHash.size,
    imported: toInsert.length,
    skipped: byHash.size - toInsert.length,
  };
}
