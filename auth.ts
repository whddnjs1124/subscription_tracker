import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";
import {
  isRateLimited,
  recordAttempt,
  clearAttempts,
  clientIp,
  loginEmailKey,
  loginIpKey,
  LOGIN_PER_EMAIL,
  LOGIN_PER_IP,
} from "@/lib/rate-limit";

/** Signals a lockout rather than a bad password, so the UI can explain itself. */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Full Auth.js setup (Node runtime). Email + password via a Credentials
 * provider, JWT sessions (required for credentials), user id carried on the
 * token/session so every query can scope by userId. See docs/HLD.md.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const emailKey = loginEmailKey(email);
        const ipKey = loginIpKey(clientIp(request));

        // Throttle before touching the password, so a locked-out attacker
        // can't keep paying for bcrypt comparisons either.
        const [byEmail, byIp] = await Promise.all([
          isRateLimited(emailKey, LOGIN_PER_EMAIL),
          isRateLimited(ipKey, LOGIN_PER_IP),
        ]);
        if (byEmail.blocked || byIp.blocked) throw new RateLimitedSignin();

        // Count failures against the typed email whether or not it exists —
        // otherwise a lockout would reveal which accounts are real.
        const fail = async () => {
          await Promise.all([
            recordAttempt(emailKey, LOGIN_PER_EMAIL),
            recordAttempt(ipKey, LOGIN_PER_IP),
          ]);
          return null;
        };

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return fail();

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return fail();

        // Proven legitimate: don't let earlier typos count toward a lockout.
        await clearAttempts(emailKey);

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
