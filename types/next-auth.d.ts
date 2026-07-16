import type { DefaultSession } from "next-auth";

// Carry the user id on the session and JWT so server code can scope by userId.
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
  interface User {
    id?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
