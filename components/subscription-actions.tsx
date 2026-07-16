"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SubscriptionActions({
  id,
  status,
  name,
  note,
}: {
  id: string;
  status: string;
  name: string;
  note: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
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
            Note
          </span>
          <input
            className="input"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder="e.g. shared with family"
          />
        </label>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={async () => {
              await patch({ name: nameValue, note: noteValue });
              setEditing(false);
            }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
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
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-amber-300 hover:text-amber-600 dark:border-zinc-700 disabled:opacity-50"
        >
          Mark cancelled
        </button>
      ) : (
        <button
          disabled={busy}
          onClick={() => patch({ status: "active" })}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-emerald-300 hover:text-emerald-600 dark:border-zinc-700 disabled:opacity-50"
        >
          Reactivate
        </button>
      )}
      <button
        disabled={busy}
        onClick={remove}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-rose-300 hover:text-rose-600 dark:border-zinc-700 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
