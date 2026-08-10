import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

export const genai = new GoogleGenAI({ apiKey });

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export async function generateJson(params: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  schema: unknown;
}): Promise<unknown> {
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
