import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { DeleteAccount } from "@/components/settings/delete-account";

export const dynamic = "force-dynamic";

function Section({
  title,
  description,
  children,
  danger = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className={danger ? "border-rose-200 dark:border-rose-900/60" : ""}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      )}
      <div className={description ? "" : "mt-4"}>{children}</div>
    </Card>
  );
}

export default async function SettingsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const [user, transactionCount, subscriptionCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.subscription.count({ where: { userId } }),
  ]);

  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle={user.email} />

      <div className="flex flex-col gap-4">
        <Section
          title="Export your data"
          description={`Download your ${transactionCount} transaction${
            transactionCount === 1 ? "" : "s"
          } and ${subscriptionCount} subscription${
            subscriptionCount === 1 ? "" : "s"
          }. JSON keeps everything; CSV is the transaction ledger, ready for a spreadsheet.`}
        >
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/export?format=json"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Download JSON
            </a>
            <a
              href="/api/export?format=csv"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Download CSV
            </a>
          </div>
        </Section>

        <Section title="Change password">
          <ChangePasswordForm />
        </Section>

        <Section title="Danger zone" danger>
          <DeleteAccount email={user.email} />
        </Section>
      </div>
    </div>
  );
}
