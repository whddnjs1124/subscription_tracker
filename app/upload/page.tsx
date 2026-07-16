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
  | "processing"
  | "done"
  | "error";

interface SpendRow {
  date: string;
  amount: number;
  rawDescription: string;
}

interface UploadPreview {
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

interface Detection {
  candidates: number;
  merchantsAnalyzed: number;
  subscriptions: DetectedSub[];
  error?: string;
}

interface FileOutcome {
  name: string;
  kind: "CSV" | "PDF";
  status: "ok" | "error";
  read: number; // spend rows found in the file
  imported: number;
  skipped: number; // duplicates skipped
  mappingSource: "ai" | "heuristic" | null;
  error?: string;
}

export default function UploadPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStatus("idle");
    setError(null);
    setFiles([]);
    setProgress(null);
    setOutcomes([]);
    setDetection(null);
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

  // Add files to the queue after validating type — no AI call yet, so the user
  // can confirm the files are right before analyzing.
  function addFiles(incoming: FileList | File[]) {
    setError(null);
    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const file of Array.from(incoming)) {
      const name = file.name.toLowerCase();
      const ok =
        name.endsWith(".csv") ||
        name.endsWith(".pdf") ||
        file.type === "text/csv" ||
        file.type === "application/vnd.ms-excel" ||
        file.type === "application/pdf";
      if (ok) accepted.push(file);
      else rejectedNames.push(file.name);
    }
    if (rejectedNames.length > 0) {
      setError(
        `Skipped unsupported file(s): ${rejectedNames.join(", ")}. Upload bank CSV exports or PDF statements.`
      );
    }
    if (accepted.length === 0) {
      if (files.length === 0) setStatus("error");
      return;
    }
    // De-duplicate by name + size so the same file isn't queued twice.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of accepted) {
        const id = `${f.name}:${f.size}`;
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(f);
        }
      }
      return merged;
    });
    setStatus("selected");
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setStatus("idle");
      return next;
    });
  }

  // Upload one file: parse CSV columns (or extract PDF text) via /api/upload.
  async function uploadFile(
    file: File
  ): Promise<UploadPreview & { csvText: string }> {
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") ||
      file.type === "application/pdf";
    let res: Response;
    let csvText = "";
    if (isPdf) {
      const form = new FormData();
      form.append("file", file);
      res = await fetch("/api/upload", { method: "POST", body: form });
    } else {
      csvText = await file.text();
      res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, csvText }),
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Analysis failed.");
    return { ...data, csvText };
  }

  // Import one already-parsed file. skipDetection: detection runs once at the end.
  async function importFile(
    p: UploadPreview & { csvText: string }
  ): Promise<{ imported: number; skipped: number }> {
    const body =
      p.source === "pdf"
        ? {
            fileName: p.fileName,
            transactions: p.transactions,
            bankGuess: p.bankGuess,
            skipDetection: true,
          }
        : {
            fileName: p.fileName,
            csvText: p.csvText,
            mapping: p.mapping,
            skipDetection: true,
          };
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Import failed.");
    return { imported: data.imported, skipped: data.skipped };
  }

  // The user confirmed the queue — analyze + import every file, then detect once.
  async function analyzeAll() {
    setStatus("processing");
    setError(null);
    const results: FileOutcome[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const kind = fileKind(file);
      setProgress({ current: i + 1, total: files.length, name: file.name });
      try {
        const preview = await uploadFile(file);
        const { imported, skipped } = await importFile(preview);
        results.push({
          name: file.name,
          kind,
          status: "ok",
          read: preview.spendCount,
          imported,
          skipped,
          mappingSource: preview.mappingSource,
        });
      } catch (err) {
        results.push({
          name: file.name,
          kind,
          status: "error",
          read: 0,
          imported: 0,
          skipped: 0,
          mappingSource: null,
          error: err instanceof Error ? err.message : "Failed.",
        });
      }
      setOutcomes([...results]);
    }

    // One detection + merchant-naming pass over everything imported.
    setProgress({ current: files.length, total: files.length, name: "Detecting subscriptions…" });
    try {
      const res = await fetch("/api/detect", { method: "POST" });
      const data = await res.json();
      setDetection(data.detection ?? null);
    } catch {
      setDetection({
        candidates: 0,
        merchantsAnalyzed: 0,
        subscriptions: [],
        error: "Detection failed.",
      });
    }
    setProgress(null);
    setStatus("done");
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  const totals = outcomes.reduce(
    (acc, o) => {
      acc.imported += o.imported;
      acc.skipped += o.skipped;
      acc.failed += o.status === "error" ? 1 : 0;
      return acc;
    },
    { imported: 0, skipped: 0, failed: 0 }
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Upload statements"
        subtitle="Import one or more bank statements (CSV or PDF) to detect subscriptions."
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.pdf,text/csv,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = ""; // allow re-picking the same file(s)
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
            Drop bank CSV or PDF statements here, or click to browse
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            You can add several files. Nothing is analyzed until you review them
            and click Analyze. Re-uploading a file you already imported is safe —
            duplicates are skipped automatically.
          </p>
        </div>
      )}

      {status === "selected" && files.length > 0 && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {files.length === 1
                ? "Ready to analyze — is this the right file?"
                : `Ready to analyze ${files.length} files — are these right?`}
            </p>
            <ul className="flex flex-col gap-2">
              {files.map((file, i) => (
                <li key={`${file.name}:${file.size}`} className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-11 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                      fileKind(file) === "PDF"
                        ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                        : "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
                    }`}
                  >
                    {fileKind(file)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{file.name}</p>
                    <p className="text-xs text-zinc-400">{formatSize(file.size)}</p>
                  </div>
                  <button
                    onClick={() => removeFile(i)}
                    aria-label={`Remove ${file.name}`}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-rose-600 dark:hover:bg-zinc-800"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {error && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={analyzeAll}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Analyze {files.length} {files.length === 1 ? "file" : "files"}
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Add more files
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {status === "processing" && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              {progress
                ? progress.name.startsWith("Detecting")
                  ? "Naming merchants and detecting subscriptions with AI…"
                  : `Reading file ${progress.current} of ${progress.total}: ${progress.name}`
                : "Working…"}
            </p>
          </Card>
          {outcomes.length > 0 && <OutcomeList outcomes={outcomes} />}
        </div>
      )}

      {status === "done" && (
        <div className="flex flex-col gap-5">
          <Card>
            <h2 className="text-lg font-semibold">Import complete</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Imported <strong>{totals.imported}</strong> new transactions
              {totals.skipped > 0 && (
                <>
                  {" "}
                  and skipped <strong>{totals.skipped}</strong> duplicate
                  {totals.skipped === 1 ? "" : "s"}
                </>
              )}
              {detection && (
                <>
                  . Detected{" "}
                  <strong>{detection.subscriptions.length}</strong> subscriptions
                  from <strong>{detection.candidates}</strong> recurring-charge
                  candidates
                </>
              )}
              .
            </p>
            {totals.failed > 0 && (
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                {totals.failed} file{totals.failed === 1 ? "" : "s"} could not be
                read — see the list below.
              </p>
            )}
            {detection?.error && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Subscription detection was skipped ({detection.error}). Your
                transactions were saved — re-upload later to detect them.
              </p>
            )}
          </Card>

          <OutcomeList outcomes={outcomes} />

          {detection && detection.subscriptions.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Detected subscriptions — reject anything that isn&apos;t yours
              </h3>
              <div className="flex flex-col gap-2">
                {detection.subscriptions.map((s) => {
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
          )}

          {detection && detection.subscriptions.length === 0 && (
            <Card>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                No recurring subscriptions detected yet — subscriptions appear
                when the same charge repeats across months. All imported expenses
                are named and listed on the{" "}
                <Link
                  href="/transactions"
                  className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                >
                  Transactions
                </Link>{" "}
                tab.
              </p>
            </Card>
          )}

          <ManualAddForm />

          <div className="flex gap-3">
            <Link
              href="/transactions"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              View transactions
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Dashboard
            </Link>
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Upload more
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <Card className="border-rose-300 dark:border-rose-800">
          <h2 className="font-semibold text-rose-600 dark:text-rose-400">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
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

function OutcomeList({ outcomes }: { outcomes: FileOutcome[] }) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Files
      </p>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {outcomes.map((o, i) => (
          <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span
              className={`flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                o.kind === "PDF"
                  ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                  : "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
              }`}
            >
              {o.kind}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{o.name}</p>
              {o.status === "ok" ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {o.imported} imported
                  {o.skipped > 0 && ` · ${o.skipped} duplicate skipped`}
                  {o.read > 0 && ` · ${o.read} read`}
                  {o.mappingSource === "heuristic" && " · columns matched by name"}
                </p>
              ) : (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {o.error}
                </p>
              )}
            </div>
            <span
              className={`shrink-0 text-xs font-medium ${
                o.status === "ok"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {o.status === "ok" ? "✓" : "failed"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
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
