"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Brand } from "@/components/brand";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Signup failed.");

      // Account created — sign in immediately.
      const login = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (login?.error) {
        setError("Account created, but sign-in failed. Try logging in.");
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed.");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-center">
        <Brand size="lg" />
      </div>

      <div className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your statements and subscriptions are private to you.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Name <span className="text-zinc-400">(optional)</span>
            </span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Jane"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Password <span className="text-zinc-400">(min 8 characters)</span>
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
