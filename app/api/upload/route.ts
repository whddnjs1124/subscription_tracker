import { NextResponse } from "next/server";
import { parseCsv, normalizeRows, heuristicMapping } from "@/lib/sources/csv";
import { inferColumnMapping } from "@/lib/gemini";
import type { ColumnMapping } from "@/lib/types";

export const runtime = "nodejs";

interface UploadBody {
  fileName?: string;
  csvText?: string;
}

export async function POST(req: Request) {
  try {
    const { fileName, csvText }: UploadBody = await req.json();

    if (!csvText || !csvText.trim()) {
      return NextResponse.json(
        { error: "No CSV content provided." },
        { status: 400 }
      );
    }

    const { headers, rows } = parseCsv(csvText);
    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json(
        { error: "Could not parse any rows from this CSV." },
        { status: 400 }
      );
    }

    const sampleRows = rows.slice(0, 5);

    // Prefer the AI column mapping; fall back to a header-name heuristic if
    // Gemini is unavailable (e.g. rate-limited) so uploads still work.
    let mapping: ColumnMapping;
    let mappingSource: "ai" | "heuristic" = "ai";
    try {
      mapping = await inferColumnMapping(headers, sampleRows);
    } catch (aiErr) {
      const fallback = heuristicMapping(headers, sampleRows);
      if (!fallback) throw aiErr;
      mapping = fallback;
      mappingSource = "heuristic";
    }

    // Preview how the mapping normalizes into spend transactions.
    const spend = normalizeRows(rows, mapping);
    const spendPreview = spend.slice(0, 8).map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      amount: t.amount,
      rawDescription: t.rawDescription,
    }));

    return NextResponse.json({
      fileName: fileName ?? "statement.csv",
      headers,
      sampleRows,
      mapping,
      mappingSource,
      totalRows: rows.length,
      spendCount: spend.length,
      spendPreview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
