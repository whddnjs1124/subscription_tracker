"use client";

import Link from "next/link";
import { Card } from "@/components/ui";

/**
 * Route-level error boundary. Without this, a failed query drops the user on
 * Next's default error screen with no way back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Card className="border-rose-200 dark:border-rose-900/60">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          This page couldn&apos;t load. Your imported data isn&apos;t affected.
        </p>
        <p className="mt-3 break-words rounded-lg bg-zinc-50 p-3 font-mono text-xs text-rose-600 dark:bg-zinc-900 dark:text-rose-400">
          {error.message || "Unknown error"}
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Back to dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}
