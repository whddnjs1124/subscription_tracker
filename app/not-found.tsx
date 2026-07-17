import Link from "next/link";
import { BrandMark } from "@/components/brand";

/** Also catches notFound() from the subscription detail page. */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center pt-20 text-center">
      <BrandMark size="lg" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        This page doesn&apos;t exist, or the subscription was deleted.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
