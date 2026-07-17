import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListSkeleton,
} from "@/components/skeletons";

/**
 * Shown while any page's server data loads. One file covers every route: they
 * all render inside the same sidebar shell and share this stats-then-list
 * shape, so a per-route skeleton would only repeat it.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeaderSkeleton />
      <StatGridSkeleton />
      <div className="mt-8">
        <ListSkeleton />
      </div>
    </div>
  );
}
