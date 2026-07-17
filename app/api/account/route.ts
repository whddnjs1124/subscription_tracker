import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Delete the signed-in user's account and everything they own. Every model
 * relates to User with onDelete: Cascade, so this single delete clears their
 * uploads, transactions, merchants, subscriptions and insights too — any new
 * model must keep that cascade or it will survive account deletion.
 *
 * The client signs out afterwards: the JWT cookie lives on until then, but it
 * only scopes queries to a userId that no longer exists.
 */
export async function DELETE() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Account deletion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
