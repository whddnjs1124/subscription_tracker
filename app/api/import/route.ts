import { NextResponse } from "next/server";
import { importCsv } from "@/lib/import";
import { detectSubscriptions } from "@/lib/detect";
import type { ColumnMapping } from "@/lib/types";

export const runtime = "nodejs";

interface ImportBody {
  fileName?: string;
  csvText?: string;
  mapping?: ColumnMapping;
}

export async function POST(req: Request) {
  try {
    const { fileName, csvText, mapping }: ImportBody = await req.json();

    if (!csvText || !mapping) {
      return NextResponse.json(
        { error: "csvText and mapping are required." },
        { status: 400 }
      );
    }

    const result = await importCsv(
      csvText,
      mapping,
      fileName ?? "statement.csv"
    );

    // Run the subscription-detection pipeline over all stored transactions.
    // Detection is idempotent, so if Gemini is unavailable (e.g. rate-limited)
    // we still return the successful import and let a later upload re-detect.
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
