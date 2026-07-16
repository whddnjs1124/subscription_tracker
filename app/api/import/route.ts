import { NextResponse } from "next/server";
import { importCsv, importNormalized } from "@/lib/import";
import { detectSubscriptions } from "@/lib/detect";
import type { ColumnMapping } from "@/lib/types";

export const runtime = "nodejs";

interface ImportBody {
  fileName?: string;
  csvText?: string;
  mapping?: ColumnMapping;
  bankGuess?: string | null;
  // PDF path: transactions already extracted at the upload step.
  transactions?: { date: string; amount: number; rawDescription: string }[];
  // When importing several files, skip detection here and run it once afterward
  // via /api/detect (avoids repeated Gemini calls per file).
  skipDetection?: boolean;
}

export async function POST(req: Request) {
  try {
    const {
      fileName,
      csvText,
      mapping,
      transactions,
      bankGuess,
      skipDetection,
    }: ImportBody = await req.json();

    let result;
    if (transactions && transactions.length >= 0 && !csvText) {
      const normalized = transactions
        .map((t) => ({
          date: new Date(t.date),
          amount: t.amount,
          rawDescription: t.rawDescription,
        }))
        .filter((t) => !isNaN(t.date.getTime()) && t.rawDescription);
      result = await importNormalized(
        normalized,
        fileName ?? "statement.pdf",
        bankGuess ?? null
      );
    } else if (csvText && mapping) {
      result = await importCsv(csvText, mapping, fileName ?? "statement.csv");
    } else {
      return NextResponse.json(
        { error: "Nothing to import." },
        { status: 400 }
      );
    }

    // Part of a multi-file batch: caller runs detection once via /api/detect.
    if (skipDetection) {
      return NextResponse.json(result);
    }

    // Run detection over all stored transactions. Non-fatal if Gemini fails.
    try {
      const detection = await detectSubscriptions();
      return NextResponse.json({ ...result, detection });
    } catch (detErr) {
      const message =
        detErr instanceof Error ? detErr.message : "Detection failed.";
      return NextResponse.json({
        ...result,
        detection: {
          candidates: 0,
          merchantsAnalyzed: 0,
          subscriptions: [],
          error: message,
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
