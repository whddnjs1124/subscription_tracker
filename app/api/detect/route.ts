import { NextResponse } from "next/server";
import { detectSubscriptions } from "@/lib/detect";
import { GeminiQuotaError } from "@/lib/gemini";
import { getUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Run the full detection + merchant-enrichment pass over the signed-in user's
 * transactions. Called once after a batch of files has been imported. Gemini
 * failure is non-fatal — transactions are already saved and can be re-analyzed.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  try {
    const detection = await detectSubscriptions(userId);
    return NextResponse.json({ detection });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detection failed.";
    return NextResponse.json({
      detection: {
        candidates: 0,
        merchantsAnalyzed: 0,
        merchantsPending: 0,
        quotaExhausted: err instanceof GeminiQuotaError,
        staleMarked: 0,
        subscriptions: [],
        error: message,
      },
    });
  }
}
