"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

const CONFIRM_WORD = "delete";

export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Account deletion failed.");
      // Clear the JWT cookie; it would otherwise point at a deleted user.
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account deletion failed.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          Permanently delete <strong>{email}</strong> along with every
          transaction, subscription and insight. This can&apos;t be undone.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-rose-800"
        >
          Delete account
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Type <code className="font-mono font-semibold">{CONFIRM_WORD}</code> to
        confirm you want to erase this account and all of its data.
      </p>
      <input
        className="input sm:max-w-xs"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={CONFIRM_WORD}
        aria-label={`Type ${CONFIRM_WORD} to confirm`}
      />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={remove}
          disabled={busy || typed.trim().toLowerCase() !== CONFIRM_WORD}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={busy}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
