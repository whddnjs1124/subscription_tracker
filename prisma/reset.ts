import { PrismaClient } from "@prisma/client";

// Wipe all data (subscriptions, transactions, merchants, insights, uploads)
// WITHOUT dropping the schema. Use this to clear the demo seed before importing
// your own statements: `npm run db:reset`.
const prisma = new PrismaClient();

async function main() {
  await prisma.subscription.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.insight.deleteMany();
  await prisma.upload.deleteMany();
  console.log("All data cleared. The dashboard is now empty.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
