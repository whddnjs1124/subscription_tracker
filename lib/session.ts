import { auth } from "@/auth";

/** The signed-in user's id, or null. Routes/pages are already gated by
 * middleware, so this is null only in edge cases — callers still guard it. */
export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
