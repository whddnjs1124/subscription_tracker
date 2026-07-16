import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config (no Node-only imports like Prisma/bcrypt). Used by
 * middleware.ts for route protection and spread into the full config in auth.ts.
 * The Credentials provider (which needs Prisma + bcrypt) is added only in auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    // Runs in middleware for every matched request. Return true to allow,
    // false to bounce to the sign-in page.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;
      const isAuthPage = path === "/login" || path === "/signup";
      if (isAuthPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true; // let logged-out users reach login/signup
      }
      return isLoggedIn; // everything else requires a session
    },
  },
} satisfies NextAuthConfig;
