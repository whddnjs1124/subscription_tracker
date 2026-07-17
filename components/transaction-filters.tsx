"use client";

import { useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MERCHANT_CATEGORIES } from "@/lib/categories";

/**
 * URL-driven filter bar for the transaction list. State lives in the query
 * string so the server component can do the filtering and the view stays
 * shareable and back-button friendly.
 */
export function TransactionFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const month = params.get("month") ?? "";

  // The input is debounced, so it holds its own value between keystrokes; this
  // resyncs it when the query string changes from elsewhere (Clear, back
  // button) rather than from typing.
  const [search, setSearch] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setSearch(q);
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    // Any filter change invalidates the current page number.
    sp.delete("page");
    router.replace(sp.size ? `/transactions?${sp}` : "/transactions");
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({ q: value }), 300);
  }

  const hasFilters = Boolean(q || category || month);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        className="input flex-1 sm:max-w-xs"
        placeholder="Search description or merchant…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        className="input w-auto"
        value={category}
        onChange={(e) => apply({ category: e.target.value })}
      >
        <option value="">All categories</option>
        {MERCHANT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        className="input w-auto"
        type="month"
        value={month}
        onChange={(e) => apply({ month: e.target.value })}
      />
      {hasFilters && (
        <button
          onClick={() => router.replace("/transactions")}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Clear
        </button>
      )}
    </div>
  );
}
