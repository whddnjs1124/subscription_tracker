import { NextResponse } from "next/server";
import { parseCsv, normalizeRows, heuristicMapping, parseDate } from "@/lib/sources/csv";
import { inferColumnMapping, extractTransactionsFromText } from "@/lib/gemini";
import { extractPdfText } from "@/lib/pdf";
import type { ColumnMapping } from "@/lib/types";

export const runtime = "nodejs";

interface UploadBody {
  fileName?: string;
  csvText?: string;
}

function guessBank(text: string): string | null {
  const map: [RegExp, string][] = [
    [/bank of america/i, "Bank of America"],
    [/chase/i, "Chase"],
    [/wells fargo/i, "Wells Fargo"],
    [/citi(bank)?/i, "Citi"],
    [/capital one/i, "Capital One"],
    [/american express|amex/i, "American Express"],
    [/discover/i, "Discover"],
    [/u\.?s\.? bank/i, "U.S. Bank"],
  ];
  for (const [re, name] of map) if (re.test(text)) return name;
  return null;
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      return await handlePdf(req);
    }
    return await handleCsv(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- PDF path: extract text, then have Gemini structure the transactions.
async function handlePdf(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (!magic.startsWith("%PDF")) {
    return NextResponse.json(
      { error: "That file isn't a valid PDF." },
      { status: 400 }
    );
  }

  const text = await extractPdfText(bytes);
  if (!text.trim() || text.replace(/\s/g, "").length < 50) {
    return NextResponse.json(
      {
        error:
          "Couldn't read any text from this PDF. If it's a scanned/image statement, download the CSV version from your bank instead.",
      },
      { status: 400 }
    );
  }

  const hint = file.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const extracted = await extractTransactionsFromText(text, hint);

  // Keep debits as spend; parse dates; drop anything unusable.
  const normalized = extracted
    .filter((t) => t.type === "debit" && t.amount > 0)
    .map((t) => ({
      date: parseDate(t.date),
      amount: t.amount,
      rawDescription: (t.description ?? "").trim(),
    }))
    .filter((t) => t.date && t.rawDescription)
    .map((t) => ({
      date: t.date!.toISOString().slice(0, 10),
      amount: t.amount,
      rawDescription: t.rawDescription,
    }));

  return NextResponse.json({
    source: "pdf",
    fileName: file.name,
    mapping: null,
    mappingSource: null,
    bankGuess: guessBank(text),
    totalRows: extracted.length,
    spendCount: normalized.length,
    spendPreview: normalized.slice(0, 8),
    transactions: normalized,
  });
}

// --- CSV path (unchanged behavior): Gemini column mapping + heuristic fallback.
async function handleCsv(req: Request) {
  const { fileName, csvText }: UploadBody = await req.json();

  if (!csvText || !csvText.trim()) {
    return NextResponse.json(
      { error: "No CSV content provided." },
      { status: 400 }
    );
  }

  const head = csvText.slice(0, 1024);
  const looksBinary =
    head.startsWith("%PDF") ||
    head.startsWith("PK") ||
    (head.match(/�/g)?.length ?? 0) > 8;
  if (looksBinary) {
    return NextResponse.json(
      {
        error:
          "This doesn't look like a CSV file. Upload a bank CSV export, or a PDF statement (we'll read it with AI).",
      },
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

  const spend = normalizeRows(rows, mapping);
  const spendPreview = spend.slice(0, 8).map((t) => ({
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    rawDescription: t.rawDescription,
  }));

  return NextResponse.json({
    source: "csv",
    fileName: fileName ?? "statement.csv",
    headers,
    sampleRows,
    mapping,
    mappingSource,
    bankGuess: mapping.bankGuess,
    totalRows: rows.length,
    spendCount: spend.length,
    spendPreview,
  });
}
