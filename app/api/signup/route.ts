import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  isRateLimited,
  recordAttempt,
  clientIp,
  signupIpKey,
  humanizeRetry,
  SIGNUP_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

interface SignupBody {
  email?: string;
  password?: string;
  name?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create a new account (email + password). Auth.js handles login separately. */
export async function POST(req: Request) {
  try {
    // This route is exempt from auth in middleware.ts, so it's the one place
    // anyone can create rows without signing in — throttle it by origin.
    const ipKey = signupIpKey(clientIp(req));
    const limited = await isRateLimited(ipKey, SIGNUP_PER_IP);
    if (limited.blocked) {
      return NextResponse.json(
        {
          error: `Too many accounts created from here. Try again ${humanizeRetry(
            limited.retryAfterSeconds
          )}.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(limited.retryAfterSeconds) },
        }
      );
    }

    const { email, password, name }: SignupBody = await req.json();
    const cleanEmail = (email ?? "").toLowerCase().trim();

    if (!EMAIL_RE.test(cleanEmail)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: { email: cleanEmail, name: name?.trim() || null, passwordHash },
    });

    // Count successful creations: it's the accounts themselves we're limiting.
    await recordAttempt(ipKey, SIGNUP_PER_IP);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
