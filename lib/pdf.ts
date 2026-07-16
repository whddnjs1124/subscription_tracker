import { extractText, getDocumentProxy } from "unpdf";

/** Extract the plain text of a PDF (all pages merged). Server-side only. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
