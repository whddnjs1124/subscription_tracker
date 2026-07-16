import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const VALID_STATUS = new Set(["active", "cancelled", "rejected"]);

interface PatchBody {
  status?: string;
  note?: string;
  name?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status, note, name }: PatchBody = await req.json();

    const existing = await prisma.subscription.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Subscription not found." },
        { status: 404 }
      );
    }

    if (status !== undefined && !VALID_STATUS.has(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(note !== undefined ? { note } : {}),
      },
    });

    // Renaming edits the underlying merchant's normalized name.
    if (name !== undefined && name.trim()) {
      await prisma.merchant.update({
        where: { id: existing.merchantId },
        data: { normalizedName: name.trim() },
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
    const { id } = await params;
    await prisma.subscription.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
