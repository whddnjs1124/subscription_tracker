import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Wipe the signed-in user's imported data (subscriptions, transactions,
 * merchants, insights, uploads) without touching other users or the account
 * itself. Lets users clear demo/test data from the UI. Deleted in FK-safe order.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  try {
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.merchant.deleteMany({ where: { userId } });
    await prisma.insight.deleteMany({ where: { userId } });
    await prisma.upload.deleteMany({ where: { userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
