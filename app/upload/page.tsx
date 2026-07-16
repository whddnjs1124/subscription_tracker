"use client";

import { useState, useRef, type DragEvent } from "react";
import Link from "next/link";
import { PageHeader, Card, CategoryBadge } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ColumnMapping } from "@/lib/types";
import { ManualAddForm } from "@/components/manual-add-form";

type Status =
  | "idle"
  | "selected"
  | "analyzing"
  | "preview"
  | "importing"
  | "done"
  | "error";

interface SpendRow {
  date: string;
  amount: number;
  rawDescription: string;
}

interface Preview {
  source: "csv" | "pdf";
  fileName: string;
  mapping: ColumnMapping | null;
  mappingSource: "ai" | "heuristic" | null;
  bankGuess: string | null;
  totalRows: number;
  spendCount: number;
  spendPreview: SpendRow[];
  transactions?: SpendRow[];
}

interface DetectedSub {
  id: string;
  name: string;
  description: string;
  category: string;
  amount: number;
  cadence: string;
  nextBillingEstimate: string;
  isNew: boolean;
}

interface ImportResult {
  uploadId: string;
  parsed: number;
  imported: number;
  skipped: number;
  detection: {
    candidates: number;
    merchantsAnalyzed: number;
    subscriptions: DetectedSub[];
    error?: string;
  };
}

export default function UploadPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStatus("idle");
    setError(null);
    setSelectedFile(null);
    setCsvText("");
    setPreview(null);
    setResult(null);
    setRejected(new Set());
  }

  async function rejectSub(id: string) {
    setRejected((prev) => new Set(prev).add(id));
    await fetch(`/api/subscriptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
  }

  // Step 1: just hold the file and validate its type — no AI call yet, so the
  // user can confirm they picked the right file before analyzing.
  function selectFile(file: File) {
    setError(null);
    const name = file.name.toLowerCase();
    const isCsv =
      name.endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel";
    const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
    if (!isCsv && !isPdf) {
      const ext = file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf(".")).toUpperCase()
        : "This";
      setError(
        `${ext} files aren't supported. Upload a bank CSV export or a PDF statement.`
      );
      setStatus("error");
      return;
    }
    setSelectedFile(file);
    setStatus("selected");
  }

  // Step 2: the user confirmed — now run the AI analysis.
  async function analyzeFile() {
    const file = selectedFile;
    if (!file) return;
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") ||
      file.type === "application/pdf";

    setError(null);
    setStatus("analyzing");
    try {
      let res: Response;
      if (isPdf) {
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/upload", { method: "POST", body: form });
      } else {
        const text = await file.text();
        setCsvText(text);
        res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, csvText: text }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed.");
      setPreview(data);
      setStatus("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setStatus("importing");
    setError(null);
    try {
      const body =
        preview.source === "pdf"
          ? {
              fileName: preview.fileName,
              transactions: preview.transactions,
              bankGuess: preview.bankGuess,
            }
          : {
              fileName: preview.fileName,
              csvText,
              mapping: preview.mapping,
            };
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) selectFile(file);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Upload statement"
        subtitle="Import a bank statement (CSV or PDF) to detect subscriptions."
      />

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.pdf,text/csv,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) selectFile(file);
          e.target.value = ""; // allow re-picking the same file
        }}
      />

      {status === "idle" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
            dragOver
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600",
          ].join(" ")}
        >
          <p className="text-base font-medium">
            Drop a bank CSV or PDF statement here, or click to browse
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Nothing is analyzed until you review the file and click Analyze.
          </p>
        </div>
      )}

      {status === "selected" && selectedFile && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Ready to analyze — is this the right file?
            </p>
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-12 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                  fileKind(selectedFile) === "PDF"
                    ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                    : "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
                }`}
              >
                {fileKind(selectedFile)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{selectedFile.name}</p>
                <p className="text-xs text-zinc-400">
                  {formatSize(selectedFile.size)}
                </p>
              </div>
            </div>
          </Card>

          <div className="flex gap-3">
            <button
              onClick={analyzeFile}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Analyze file
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Choose a different file
            </button>
          </div>
        </div>
      )}

      {status === "analyzing" && (
        <Card>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            Reading your statement with AI…
          </p>
        </Card>
      )}

      {status === "preview" && preview && (
        <div className="flex flex-col gap-5">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{preview.fileName}</h2>
              <div className="flex items-center gap-2">
                {preview.source === "pdf" && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                    PDF · AI-read
                  </span>
                )}
                {preview.bankGuess && (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {preview.bankGuess}
                  </span>
                )}
              </div>
            </div>

            {preview.source === "csv" && preview.mapping ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <MapField label="Date column" value={preview.mapping.dateColumn} />
                <MapField
                  label="Description"
                  value={preview.mapping.descriptionColumn}
                />
                <MapField
                  label="Amount column"
                  value={preview.mapping.amountColumn}
                />
                <MapField
                  label="Spend rows"
                  value={`${preview.spendCount} of ${preview.totalRows}`}
                />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                Read <strong>{preview.spendCount}</strong> spending transactions
                from your PDF
                {preview.totalRows > preview.spendCount &&
                  ` (deposits and incoming payments excluded)`}
                . Check the preview below before importing.
              </p>
            )}

            {preview.mappingSource === "heuristic" && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                AI mapping was unavailable — columns were matched by name.
                Double-check the preview below before importing.
              </p>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Preview of detected spend
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.spendPreview.map((t, i) => (
                  <tr
                    key={i}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-2 tabular-nums text-zinc-500">{t.date}</td>
                    <td className="py-2 pr-4">{t.rawDescription}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex gap-3">
            <button
              onClick={confirmImport}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Import {preview.spendCount} transactions
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "importing" && (
        <Card>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            Importing transactions…
          </p>
        </Card>
      )}

      {status === "done" && result && (
        <div className="flex flex-col gap-5">
          <Card>
            <h2 className="text-lg font-semibold">Import complete</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Imported <strong>{result.imported}</strong> new transactions
              {result.skipped > 0 && (
                <>
                  {" "}
                  and skipped <strong>{result.skipped}</strong> duplicates
                </>
              )}
              . Detected <strong>{result.detection.subscriptions.length}</strong>{" "}
              subscriptions from{" "}
              <strong>{result.detection.candidates}</strong> recurring-charge
              candidates.
            </p>
            {result.detection.error && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Subscription detection was skipped ({result.detection.error}).
                Your transactions were saved — re-upload later to detect them.
              </p>
            )}
          </Card>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Detected subscriptions — reject anything that isn&apos;t yours
            </h3>
            <div className="flex flex-col gap-2">
              {result.detection.subscriptions.map((s) => {
                const isRejected = rejected.has(s.id);
                return (
                  <Card
                    key={s.id}
                    className={isRejected ? "opacity-50" : undefined}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-medium ${isRejected ? "line-through" : ""}`}
                          >
                            {s.name}
                          </span>
                          <CategoryBadge category={s.category} />
                          {s.isNew && !isRejected && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                              new
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                          {s.description} · next {formatDate(s.nextBillingEstimate)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="tabular-nums font-medium">
                          {formatCurrency(s.amount)}
                          <span className="text-xs text-zinc-400">
                            /{s.cadence.replace("ly", "")}
                          </span>
                        </span>
                        {!isRejected && (
                          <button
                            onClick={() => rejectSub(s.id)}
                            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          <ManualAddForm />

          <div className="flex gap-3">
            <Link
              href="/"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              View dashboard
            </Link>
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Upload another
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <Card className="border-rose-300 dark:border-rose-800">
          <h2 className="font-semibold text-rose-600 dark:text-rose-400">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            {error}
          </p>
          <button
            onClick={reset}
            className="mt-4 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Try again
          </button>
        </Card>
      )}
    </div>
  );
}

function MapField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function fileKind(file: File): "PDF" | "CSV" {
  return file.name.toLowerCase().endsWith(".pdf") ||
    file.type === "application/pdf"
    ? "PDF"
    : "CSV";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
