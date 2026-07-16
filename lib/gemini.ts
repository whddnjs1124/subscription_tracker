import { GoogleGenAI, Type } from "@google/genai";
import type { ColumnMapping, MerchantAnalysis } from "@/lib/types";
import { MERCHANT_CATEGORIES } from "@/lib/categories";

// gemini-2.5-flash is no longer available to new API keys; 3.5-flash is the
// current stable flash model (verified against models.list for this key).
const MODEL = "gemini-3.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set (add it to .env.local).");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Call Gemini expecting a JSON response that matches `schema`, with one retry.
 * All Gemini access in this app goes through helpers in this file.
 */
async function generateJson<T>(
  prompt: string,
  schema: Record<string, unknown>
): Promise<T> {
  const ai = getClient();

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          responseSchema: schema as any,
          temperature: 0,
        },
      });
      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini.");
      return JSON.parse(text) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Gemini request failed after retry: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/**
 * Infer which CSV columns hold the date, description, and amount, plus how the
 * amount column encodes spend vs. income. See docs/HLD.md §3.1.
 */
export async function inferColumnMapping(
  headers: string[],
  sampleRows: Record<string, string>[]
): Promise<ColumnMapping> {
  const prompt = `You are given the header and a few sample rows of a bank transaction CSV export.
Identify which columns hold the transaction date, the description/memo, and the amount.
Also decide how the amount column encodes spending:
- "negative_is_spend": debits/purchases are negative numbers (most common for US banks).
- "positive_is_spend": the amount is always positive and a separate sign/type is not given.
Guess the bank name from the columns/format if obvious, else null.

Header columns: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sampleRows.slice(0, 5))}

Return the exact column names as they appear in the header.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      dateColumn: { type: Type.STRING },
      descriptionColumn: { type: Type.STRING },
      amountColumn: { type: Type.STRING },
      amountSign: {
        type: Type.STRING,
        enum: ["negative_is_spend", "positive_is_spend"],
      },
      bankGuess: { type: Type.STRING, nullable: true },
    },
    required: [
      "dateColumn",
      "descriptionColumn",
      "amountColumn",
      "amountSign",
    ],
  };

  const result = await generateJson<ColumnMapping>(prompt, schema);
  return {
    ...result,
    bankGuess: result.bankGuess || null,
  };
}

export interface MerchantAnalysisInput {
  key: string; // merchant grouping key (echoed back as rawPattern)
  sampleDescription: string;
  amount: number;
  cadence: string;
}

/**
 * Stage 2 of detection: given recurring-charge candidates, have Gemini
 * normalize each merchant name, describe it, categorize it, and judge whether
 * it is a genuine subscription service. Batched into one call. See HLD §3.2.
 */
export async function analyzeMerchants(
  inputs: MerchantAnalysisInput[]
): Promise<MerchantAnalysis[]> {
  if (inputs.length === 0) return [];

  const prompt = `You are analyzing recurring charges found on a bank statement.
For each merchant below, return:
- rawPattern: echo back the given "key" EXACTLY and unchanged.
- normalizedName: the clean, human brand name (e.g. "SPOTIFY USA 8778774166 NY" -> "Spotify").
- description: a short (max ~8 word) plain-English description of what the service is.
- category: one of ${JSON.stringify(MERCHANT_CATEGORIES)}.
- isSubscription: true ONLY if this is a genuine recurring subscription to a service
  (streaming, software, gym, phone plan, internet, utilities, news, meal-kit, etc.).
  Set it FALSE for recurring charges that are NOT subscription services, such as
  credit-card or loan autopayments, transfers, ATM withdrawals, rent, or routine
  purchases at a store/restaurant/gas station.

Merchants:
${JSON.stringify(
  inputs.map((i) => ({
    key: i.key,
    example: i.sampleDescription,
    amount: i.amount,
    cadence: i.cadence,
  })),
  null,
  2
)}`;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        rawPattern: { type: Type.STRING },
        normalizedName: { type: Type.STRING },
        description: { type: Type.STRING },
        category: { type: Type.STRING, enum: [...MERCHANT_CATEGORIES] },
        isSubscription: { type: Type.BOOLEAN },
      },
      required: [
        "rawPattern",
        "normalizedName",
        "description",
        "category",
        "isSubscription",
      ],
    },
  };

  return generateJson<MerchantAnalysis[]>(prompt, schema);
}

/**
 * Generate a short markdown narrative summarizing the user's subscription
 * spending, given a compact stats summary. Plain text (no JSON schema).
 */
export async function generateInsightNarrative(
  summary: string
): Promise<string> {
  const ai = getClient();
  const prompt = `You are a friendly personal-finance assistant. Given this summary of a
user's recurring subscriptions, write a concise markdown briefing (about 120-160 words).
Use a few short bullet points. Call out the total cost, any overlapping/duplicate
services worth reviewing, anything that looks unused, and one practical suggestion to
save money. Be specific with the numbers. Do not invent data beyond the summary.

Summary:
${summary}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { temperature: 0.4 },
  });
  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini.");
  return text;
}

export { generateJson, Type };
