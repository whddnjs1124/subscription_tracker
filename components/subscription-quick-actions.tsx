"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Single-purpose Reactivate button for the subscription list. Everything else
 * lives on the detail page — this exists so a subscription that was retired or
 * rejected can be brought back without hunting for its URL.
 */
export function ReactivateButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reactivate(e: React.MouseEvent) {
    // The whole row is a link; this button is inside it.
    e.preventDefault();
    e.stopPropagation();

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not reactivate.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reactivate.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={reactivate}
        disabled={busy}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:text-emerald-400"
      >
        {busy ? "…" : "Reactivate"}
      </button>
      {error && (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      )}
    </div>
  );
}
