import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { nextBilling } from "@/lib/detection";
import { MERCHANT_CATEGORIES } from "@/lib/categories";
import type { SubscriptionCadence } from "@/lib/types";

export const runtime = "nodejs";

// `stale` is deliberately absent: it's system-set only (lib/lifecycle.ts).
// Sending a stale subscription to `active` here is the Reactivate path.
const VALID_STATUS = new Set(["active", "cancelled", "rejected"]);
const VALID_CADENCE = new Set<string>(["weekly", "monthly", "yearly"]);

interface PatchBody {
  status?: string;
  note?: string;
  name?: string;
  amount?: number;
  cadence?: string;
  category?: string;
  nextBillingEstimate?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const { id } = await params;
    const {
      status,
      note,
      name,
      amount,
      cadence,
      category,
      nextBillingEstimate,
    }: PatchBody = await req.json();

    const existing = await prisma.subscription.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Subscription not found." },
        { status: 404 }
      );
    }

    if (status !== undefined && !VALID_STATUS.has(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    if (
      amount !== undefined &&
      (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    ) {
      return NextResponse.json(
        { error: "Amount must be a positive number." },
        { status: 400 }
      );
    }
    if (cadence !== undefined && !VALID_CADENCE.has(cadence)) {
      return NextResponse.json({ error: "Invalid cadence." }, { status: 400 });
    }
    if (
      category !== undefined &&
      !(MERCHANT_CATEGORIES as readonly string[]).includes(category)
    ) {
      return NextResponse.json({ error: "Invalid category." }, { status: 400 });
    }

    let nextBillingDate: Date | undefined;
    if (nextBillingEstimate !== undefined) {
      nextBillingDate = new Date(nextBillingEstimate);
      if (Number.isNaN(nextBillingDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid next billing date." },
          { status: 400 }
        );
      }
    }

    // Editing any of the detected facts pins them: re-detection must leave
    // them alone from now on, or the next import would silently undo the fix.
    const userEdited =
      amount !== undefined ||
      cadence !== undefined ||
      nextBillingEstimate !== undefined;

    // A new cadence invalidates the old estimate unless the user set one too.
    const recomputedNextBilling =
      cadence !== undefined && nextBillingDate === undefined
        ? nextBilling(existing.lastCharged, cadence as SubscriptionCadence)
        : undefined;

    const updated = await prisma.subscription.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(cadence !== undefined ? { cadence } : {}),
        ...(nextBillingDate !== undefined
          ? { nextBillingEstimate: nextBillingDate }
          : recomputedNextBilling !== undefined
            ? { nextBillingEstimate: recomputedNextBilling }
            : {}),
        ...(userEdited ? { userEdited: true } : {}),
      },
    });

    // Name and category describe the merchant, not this subscription, so they
    // live on the Merchant row (which detection never rewrites once cached).
    const merchantData = {
      ...(name !== undefined && name.trim()
        ? { normalizedName: name.trim() }
        : {}),
      ...(category !== undefined ? { category } : {}),
    };
    if (Object.keys(merchantData).length > 0) {
      await prisma.merchant.update({
        where: { id: existing.merchantId },
        data: merchantData,
      });
    }

    return NextResponse.json({ ok: true, subscription: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const { id } = await params;
    // deleteMany with the userId guard: a no-op if the row isn't the user's.
    await prisma.subscription.deleteMany({ where: { id, userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
