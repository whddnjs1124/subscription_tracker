import { NextResponse } from "next/server";
import { detectSubscriptions } from "@/lib/detect";

export const runtime = "nodejs";

/**
 * Run the full detection + merchant-enrichment pass over all stored
 * transactions. Called once after a batch of files has been imported. Gemini
 * failure is non-fatal — transactions are already saved and can be re-analyzed.
 */
export async function POST() {
  try {
    const detection = await detectSubscriptions();
    return NextResponse.json({ detection });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detection failed.";
    return NextResponse.json({
      detection: {
        candidates: 0,
        merchantsAnalyzed: 0,
        subscriptions: [],
        error: message,
      },
    });
  }
}
