import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeInsights, statsSummary } from "@/lib/insights";
import { generateInsightNarrative } from "@/lib/gemini";
import { getUserId } from "@/lib/session";

export const runtime = "nodejs";

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Return the AI narrative for the current month, generating and caching it on
 * first request (docs/HLD.md §3.3). Pass { refresh: true } to regenerate.
 */
export async function POST(req: Request) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const refresh = body?.refresh === true;
    const month = monthKey();

    if (!refresh) {
      const cached = await prisma.insight.findUnique({
        where: { userId_month: { userId, month } },
      });
      if (cached) {
        return NextResponse.json({ content: cached.content, cached: true });
      }
    }

    const stats = await computeInsights(userId);
    if (stats.activeCount === 0) {
      return NextResponse.json(
        { error: "No active subscriptions to analyze yet." },
        { status: 400 }
      );
    }

    const content = await generateInsightNarrative(statsSummary(stats));

    const saved = await prisma.insight.upsert({
      where: { userId_month: { userId, month } },
      update: { content, generatedAt: new Date() },
      create: { userId, month, content },
    });

    return NextResponse.json({ content: saved.content, cached: false });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate insights.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
