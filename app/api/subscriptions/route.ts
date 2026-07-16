import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { nextBilling } from "@/lib/detection";
import type { SubscriptionCadence } from "@/lib/types";

export const runtime = "nodejs";

const VALID_CADENCE = new Set(["weekly", "monthly", "yearly"]);

interface CreateBody {
  name?: string;
  amount?: number;
  cadence?: string;
  category?: string;
  description?: string;
}

/** Manually add a subscription the detector missed. */
export async function POST(req: Request) {
  try {
    const { name, amount, cadence, category, description }: CreateBody =
      await req.json();

    if (!name?.trim() || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "A name and a positive amount are required." },
        { status: 400 }
      );
    }
    if (!cadence || !VALID_CADENCE.has(cadence)) {
      return NextResponse.json(
        { error: "Cadence must be weekly, monthly, or yearly." },
        { status: 400 }
      );
    }

    const now = new Date();
    // Manual merchants get a distinct rawPattern so they never collide with
    // detected ones (which are derived from bank descriptions).
    const rawPattern = `MANUAL:${name.trim().toUpperCase()}`;

    const merchant = await prisma.merchant.upsert({
      where: { rawPattern },
      update: {
        normalizedName: name.trim(),
        description: description?.trim() || "Manually added subscription",
        category: category?.trim() || "other",
        isSubscriptionService: true,
      },
      create: {
        rawPattern,
        normalizedName: name.trim(),
        description: description?.trim() || "Manually added subscription",
        category: category?.trim() || "other",
        isSubscriptionService: true,
      },
    });

    const subscription = await prisma.subscription.create({
      data: {
        merchantId: merchant.id,
        amount,
        cadence,
        firstSeen: now,
        lastCharged: now,
        nextBillingEstimate: nextBilling(now, cadence as SubscriptionCadence),
        status: "active",
        isManual: true,
      },
    });

    return NextResponse.json({ ok: true, subscription });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
