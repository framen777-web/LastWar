import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey } from "@/lib/settings";

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export async function generateJson(params: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  schema: unknown;
}): Promise<unknown> {
  // Built per call (not a module-level singleton) so a key saved via Setup -> Settings
  // takes effect immediately, without needing an env var + redeploy.
  const apiKey = await getGeminiApiKey();
  const genai = new GoogleGenAI({ apiKey });

  const response = await genai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: params.prompt },
          { inlineData: { data: params.imageBase64, mimeType: params.mimeType } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: params.schema,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no text in response");
  }
  return JSON.parse(text);
}
