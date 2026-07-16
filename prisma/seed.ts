import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Demo account the seed data belongs to. Log in with these to see the portfolio
// dataset. (Multi-user: every row is owned by a user.)
const DEMO_EMAIL = "demo@subtracker.app";
const DEMO_PASSWORD = "demo1234";

// Deterministic demo data — NO Gemini calls. Populates a realistic portfolio
// dataset: 6 months of history, category overlaps, a price increase, and a
// possibly-unused subscription. Charges are anchored to fixed months so the
// demo is reproducible.
const MONTHS = [
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
];

function dateOf(ym: string, day: number): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function nextBilling(last: Date): Date {
  const d = new Date(last);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

function hash(date: Date, amount: number, desc: string): string {
  const key = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${desc.toLowerCase()}`;
  return createHash("sha256").update(key).digest("hex");
}

interface DemoSub {
  rawPattern: string;
  name: string;
  description: string;
  category: string;
  rawDescription: string; // as it would appear on a statement
  day: number;
  amount: number;
  priceByMonth?: Record<string, number>; // overrides for a price change
  months?: string[]; // defaults to all 6
}

const DEMO: DemoSub[] = [
  {
    rawPattern: "SPOTIFY USA NY",
    name: "Spotify",
    description: "Music and podcast streaming",
    category: "entertainment",
    rawDescription: "SPOTIFY USA 8778774166 NY",
    day: 5,
    amount: 11.99,
  },
  {
    rawPattern: "NETFLIX.COM CA",
    name: "Netflix",
    description: "Video streaming service",
    category: "entertainment",
    rawDescription: "NETFLIX.COM 8887162102 CA",
    day: 12,
    amount: 17.99,
    priceByMonth: {
      "2026-02": 15.49,
      "2026-03": 15.49,
      "2026-04": 15.49,
      "2026-05": 17.99,
      "2026-06": 17.99,
      "2026-07": 17.99,
    },
  },
  {
    rawPattern: "DISNEY PLUS",
    name: "Disney+",
    description: "Video streaming service",
    category: "entertainment",
    rawDescription: "DISNEY PLUS 888-905-7888 CA",
    day: 9,
    amount: 13.99,
  },
  {
    rawPattern: "COMCAST XFINITY -COMCAST",
    name: "Xfinity",
    description: "Home internet and cable",
    category: "telecom",
    rawDescription: "COMCAST XFINITY 800-COMCAST",
    day: 18,
    amount: 79.99,
  },
  {
    rawPattern: "T-MOBILE POSTPAID",
    name: "T-Mobile",
    description: "Mobile phone plan",
    category: "telecom",
    rawDescription: "T-MOBILE POSTPAID 8009377626",
    day: 15,
    amount: 70.0,
  },
  {
    rawPattern: "PG&E ELECTRIC PAYMENT",
    name: "PG&E",
    description: "Electricity and gas utility",
    category: "utilities",
    rawDescription: "PG&E ELECTRIC PAYMENT 8007438000",
    day: 22,
    amount: 94.2,
    priceByMonth: {
      "2026-02": 88.4,
      "2026-03": 91.1,
      "2026-04": 86.75,
      "2026-05": 97.3,
      "2026-06": 90.15,
      "2026-07": 94.2,
    },
  },
  {
    rawPattern: "PLANET FIT FL",
    name: "Planet Fitness",
    description: "Gym membership",
    category: "fitness",
    rawDescription: "PLANET FIT 8135391500 FL",
    day: 1,
    amount: 24.99,
  },
  {
    rawPattern: "ADOBE CREATIVE CLOUD",
    name: "Adobe Creative Cloud",
    description: "Creative design software suite",
    category: "software",
    rawDescription: "ADOBE *CREATIVE CLOUD 4085366000 CA",
    day: 7,
    amount: 54.99,
  },
  {
    rawPattern: "OPENAI CHATGPT SUBSCR",
    name: "ChatGPT Plus",
    description: "AI assistant subscription",
    category: "software",
    rawDescription: "OPENAI *CHATGPT SUBSCR",
    day: 3,
    amount: 20.0,
  },
  {
    rawPattern: "NYTIMES DIGITAL",
    name: "The New York Times",
    description: "Digital news subscription",
    category: "news",
    rawDescription: "NYTIMES*NYTIMES 8666736775 NY",
    day: 14,
    amount: 17.0,
    months: ["2026-02", "2026-03", "2026-04"], // stopped charging -> stale
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Demo User", passwordHash },
  });
  const userId = user.id;

  console.log("Clearing existing demo data…");
  await prisma.subscription.deleteMany({ where: { userId } });
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.merchant.deleteMany({ where: { userId } });
  await prisma.insight.deleteMany({ where: { userId } });
  await prisma.upload.deleteMany({ where: { userId } });

  const upload = await prisma.upload.create({
    data: { userId, fileName: "demo-seed.csv", bankGuess: "Demo Bank" },
  });

  let txCount = 0;

  for (const d of DEMO) {
    const months = d.months ?? MONTHS;

    const merchant = await prisma.merchant.create({
      data: {
        userId,
        rawPattern: d.rawPattern,
        normalizedName: d.name,
        description: d.description,
        category: d.category,
        isSubscriptionService: true,
      },
    });

    const charges: { date: Date; amount: number }[] = [];
    for (const ym of months) {
      const amount = d.priceByMonth?.[ym] ?? d.amount;
      const date = dateOf(ym, d.day);
      charges.push({ date, amount });
      await prisma.transaction.create({
        data: {
          userId,
          uploadId: upload.id,
          merchantId: merchant.id,
          date,
          amount,
          rawDescription: d.rawDescription,
          dedupeHash: hash(date, amount, d.rawDescription),
        },
      });
      txCount++;
    }

    const first = charges[0];
    const last = charges[charges.length - 1];
    await prisma.subscription.create({
      data: {
        userId,
        merchantId: merchant.id,
        amount: last.amount,
        cadence: "monthly",
        firstSeen: first.date,
        lastCharged: last.date,
        nextBillingEstimate: nextBilling(last.date),
        status: "active",
      },
    });
  }

  await prisma.upload.update({
    where: { id: upload.id },
    data: { transactionCount: txCount },
  });

  console.log(
    `Seeded ${DEMO.length} subscriptions and ${txCount} transactions for the demo account.`
  );
  console.log(`Log in with:  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
