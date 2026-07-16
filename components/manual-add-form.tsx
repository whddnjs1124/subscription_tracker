"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { MERCHANT_CATEGORIES } from "@/lib/categories";

export function ManualAddForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [category, setCategory] = useState("entertainment");
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!name.trim() || isNaN(amt) || amt <= 0) {
      setError("Enter a name and a positive amount.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, amount: amt, cadence, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add.");
      setAdded(name.trim());
      setName("");
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
      >
        + Add a subscription manually
      </button>
    );
  }

  return (
    <Card>
      <h3 className="font-semibold">Add a subscription manually</h3>
      {added && (
        <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
          Added {added}. Add another or view the dashboard.
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Disney+"
            className="input"
          />
        </Field>
        <Field label="Amount (USD)">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="9.99"
            className="input"
          />
        </Field>
        <Field label="Billing cadence">
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className="input"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input capitalize"
          >
            {MERCHANT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
      <div className="mt-4 flex gap-3">
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add subscription"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Done
        </button>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
