"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

/** Minimal markdown rendering (bullets + bold) without a dependency. */
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul
          key={`ul-${blocks.length}`}
          className="my-2 list-disc space-y-1 pl-5"
        >
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flush();
      const clean = line.replace(/^#+\s*/, "");
      blocks.push(
        <p key={`p-${blocks.length}`} className="my-2">
          {inline(clean)}
        </p>
      );
    }
  }
  flush();
  return blocks;
}

export function InsightNarrative({ initial }: { initial: string | null }) {
  const [content, setContent] = useState<string | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate.");
      setContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">AI summary</h2>
        {content && (
          <button
            onClick={() => generate(true)}
            disabled={loading}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400"
          >
            Regenerate
          </button>
        )}
      </div>

      {content ? (
        <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {renderMarkdown(content)}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Get an AI-written briefing on your subscription spending.
          </p>
          <button
            onClick={() => generate(false)}
            disabled={loading}
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate AI summary"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
    </Card>
  );
}
