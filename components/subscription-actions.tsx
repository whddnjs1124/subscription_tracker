"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MERCHANT_CATEGORIES } from "@/lib/categories";

interface Props {
  id: string;
  status: string;
  name: string;
  note: string | null;
  amount: number;
  cadence: string;
  category: string;
  /** ISO date (yyyy-mm-dd) for the date input. */
  nextBillingEstimate: string;
  userEdited: boolean;
}

export function SubscriptionActions({
  id,
  status,
  name,
  note,
  amount,
  cadence,
  category,
  nextBillingEstimate,
  userEdited,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [amountValue, setAmountValue] = useState(String(amount));
  const [cadenceValue, setCadenceValue] = useState(cadence);
  const [categoryValue, setCategoryValue] = useState(category);
  const [nextBillingValue, setNextBillingValue] = useState(nextBillingEstimate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed.");
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const parsedAmount = Number(amountValue);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }

    // Only send what actually changed: the server sets `userEdited` whenever
    // amount/cadence/next-billing appear, and merely opening the form
    // shouldn't pin those fields against future detection.
    const body: Record<string, unknown> = {
      name: nameValue,
      note: noteValue,
    };
    if (parsedAmount !== amount) body.amount = parsedAmount;
    if (cadenceValue !== cadence) body.cadence = cadenceValue;
    if (categoryValue !== category) body.category = categoryValue;
    if (nextBillingValue !== nextBillingEstimate) {
      body.nextBillingEstimate = nextBillingValue;
    }

    if (await patch(body)) setEditing(false);
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
      router.push("/subscriptions");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Name
            </span>
            <input
              className="input"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Category
            </span>
            <select
              className="input"
              value={categoryValue}
              onChange={(e) => setCategoryValue(e.target.value)}
            >
              {MERCHANT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Amount (USD)
            </span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={amountValue}
              onChange={(e) => setAmountValue(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Billing cycle
            </span>
            <select
              className="input"
              value={cadenceValue}
              onChange={(e) => setCadenceValue(e.target.value)}
            >
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Next billing
            </span>
            <input
              className="input"
              type="date"
              value={nextBillingValue}
              onChange={(e) => setNextBillingValue(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Note
            </span>
            <input
              className="input"
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder="e.g. shared with family"
            />
          </label>
        </div>

        <p className="text-xs text-zinc-400">
          Editing the amount, billing cycle, or next billing date pins them —
          future imports won&apos;t overwrite your values.
        </p>

        {error && (
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={save}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Edit
        </button>
        {status === "active" ? (
          <button
            disabled={busy}
            onClick={() => patch({ status: "cancelled" })}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-amber-300 hover:text-amber-600 disabled:opacity-50 dark:border-zinc-700"
          >
            Mark cancelled
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => patch({ status: "active" })}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-emerald-300 hover:text-emerald-600 disabled:opacity-50 dark:border-zinc-700"
          >
            Reactivate
          </button>
        )}
        <button
          disabled={busy}
          onClick={remove}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 dark:border-zinc-700"
        >
          Delete
        </button>
      </div>
      {userEdited && (
        <p className="text-xs text-zinc-400">
          Edited manually — detection won&apos;t overwrite the amount or billing
          cycle.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}
