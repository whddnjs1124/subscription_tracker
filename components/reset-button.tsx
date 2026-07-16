"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Danger-zone button that clears ALL imported data via /api/reset. Two-step
 * confirm so it can't be triggered by accident. Works anywhere the app is
 * deployed (no terminal needed).
 */
export function ResetButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doReset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reset failed.");
      setConfirming(false);
      router.refresh(); // re-render server components with the now-empty data
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-rose-800"
      >
        Clear all data
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Delete every imported transaction and subscription?
        </span>
        <button
          onClick={doReset}
          disabled={busy}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
        >
          {busy ? "Clearing…" : "Yes, delete everything"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
      {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}
