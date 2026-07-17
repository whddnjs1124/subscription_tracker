"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-run the detection pass over already-imported transactions. Detection is
 * idempotent and merchant analyses are cached, so this only costs Gemini calls
 * for merchants that were never labeled — which is exactly the case this
 * button exists for (a quota-exhausted import left some unanalyzed).
 */
export function RerunDetection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rerun() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/detect", { method: "POST" });
      const data = await res.json();
      const detection = data.detection;

      if (detection?.quotaExhausted) {
        setError(
          "Still out of AI quota — the free tier resets daily. Your transactions are safe; try again later."
        );
        return;
      }
      if (detection?.error) {
        setError(detection.error);
        return;
      }

      const found = detection?.subscriptions?.length ?? 0;
      const pending = detection?.merchantsPending ?? 0;
      setMessage(
        pending > 0
          ? `Analyzed ${detection.merchantsAnalyzed} merchant(s); ${pending} still pending.`
          : `Done — ${found} subscription(s) detected.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={rerun}
        disabled={busy}
        className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:bg-transparent dark:text-amber-400 dark:hover:bg-amber-500/10"
      >
        {busy ? "Analyzing…" : "Re-run detection"}
      </button>
      {message && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{message}</span>
      )}
      {error && (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      )}
    </div>
  );
}
