import { PrismaClient } from "@prisma/client";

// Wipe all data (subscriptions, transactions, merchants, insights, uploads)
// WITHOUT dropping the schema. Use this to clear the demo seed before importing
// your own statements: `npm run db:reset`.
const prisma = new PrismaClient();

async function main() {
  // Dev CLI: full wipe of EVERY user's data and accounts. (The in-app
  // "Clear all data" button only clears the signed-in user's data.)
  await prisma.subscription.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.insight.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.user.deleteMany();
  console.log("All data and accounts cleared.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
