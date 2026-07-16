import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Wipe all imported data (subscriptions, transactions, merchants, insights,
 * uploads) without dropping the schema — the web-app equivalent of
 * `npm run db:reset`, so users can clear demo/test data from the UI (works on
 * Vercel where there's no terminal). Deleted in FK-safe order.
 */
export async function POST() {
  try {
    await prisma.subscription.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.merchant.deleteMany();
    await prisma.insight.deleteMany();
    await prisma.upload.deleteMany();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
