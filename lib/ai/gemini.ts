import { GoogleGenAI, MediaResolution } from "@google/genai";
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
      // This is a straight transcription/classification task, not a reasoning task -
      // thinking tokens are billed against the same maxOutputTokens budget as the JSON
      // we actually want back, and Gemini 2.5's thinking-by-default behavior has a
      // well-documented history of silently truncating structured output on longer
      // responses (a big roster screenshot) once that shared budget runs out mid-string.
      // Disabling it removes that failure mode entirely for a task this simple.
      thinkingConfig: { thinkingBudget: 0 },
      // Explicit generous ceiling so a big roster/ranking screenshot (50-100+ rows)
      // never runs the model's default limit close, now that no thinking tokens are
      // competing for it either.
      maxOutputTokens: 8192,
      // Default resolution is model-chosen and untested for this app's screenshots -
      // "high" spends more tokens per image to let the model see more detail, which
      // should help with small/dense in-game text and non-Latin glyphs specifically.
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    const thoughts = response.usageMetadata?.thoughtsTokenCount;
    const output = response.usageMetadata?.candidatesTokenCount;
    throw new Error(
      `Gemini response was truncated (hit the output token limit) - extraction is incomplete/unreliable ` +
        `(thoughtsTokenCount=${thoughts ?? "?"}, candidatesTokenCount=${output ?? "?"})`
    );
  }

  const text = response.text;
  if (!text) {
    throw new Error(`Gemini returned no text in response (finishReason: ${finishReason ?? "unknown"})`);
  }
  return JSON.parse(text);
}
