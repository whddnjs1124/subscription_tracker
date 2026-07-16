import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-safe auth instance (authConfig has no Node deps) used purely for route
// protection via the `authorized` callback.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Protect everything except the auth API, the signup API, and static assets.
  matcher: ["/((?!api/auth|api/signup|_next/static|_next/image|favicon.ico).*)"],
};
