# Fix: name-reading accuracy (truncated names, non-Latin mismatches)

For the Claude Code session on Frans's machine. Two independent, concrete
bugs — not a "the model just isn't good enough" situation. Both confirmed
against the actual installed `@google/genai` v2.16.0 type definitions
(`node_modules/@google/genai/dist/genai.d.ts`), not guessed from docs.

## Root cause 1: Gemini's "thinking" tokens are silently eating the output budget

`lib/ai/gemini.ts`'s call to `genai.models.generateContent()` sets no
`thinkingConfig` and no `maxOutputTokens`:

```ts
// lib/ai/gemini.ts, lines 17-32 (current)
const response = await genai.models.generateContent({
  model: MODEL,
  contents: [...],
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
```

Gemini 2.5 Flash has "thinking" turned on by default, and thinking tokens
are billed against the *same* `maxOutputTokens` budget as the actual JSON
you want back — this is a widely-reported Gemini 2.5 issue, not something
specific to this app (see sources below: people hitting `finishReason:
MAX_TOKENS` with empty or truncated text, threads titled literally
"Gemini 2.5 Flash was returning 37 tokens" and "thinking tokens consume
maxOutputTokens, causing empty responses"). When the shared budget runs out
mid-response, the API can return a still-*parseable* JSON object where
whatever string field was mid-generation gets force-closed early — which
matches "names cut in half" exactly: not a misread, a mid-word truncation.
Bigger screenshots (a full roster, more rows) are more likely to hit this
than a short one, since there's more content competing for the same budget.

The current code has no way to even detect this — `response.text` being
non-empty is treated as success regardless of whether generation actually
finished cleanly. I confirmed against the SDK's own types
(`genai.d.ts` lines 1518-1521, 4662, 5741, 5767, 13055-13061) that:
- `Candidate.finishReason` exists and includes `"MAX_TOKENS"` as a value.
- `GenerationConfig.thinkingConfig?.thinkingBudget` exists — "0 is
  DISABLED. -1 is AUTOMATIC" per the SDK's own doc comment.
- `GenerationConfig.maxOutputTokens` and `GenerationConfig.mediaResolution`
  are both valid sibling fields on the same config object already in use.

### Fix — `lib/ai/gemini.ts`

Replace the whole file with:

```ts
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
      mediaResolution: "MEDIA_RESOLUTION_HIGH" as never,
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
```

What changed and why each piece matters:
- `thinkingConfig: { thinkingBudget: 0 }` — removes the actual mechanism
  that's most likely causing truncated names.
- `maxOutputTokens: 8192` — a safety ceiling well above what even a large
  roster screenshot needs, now that thinking isn't competing for it.
- `mediaResolution: "MEDIA_RESOLUTION_HIGH"` — spends more tokens per image
  so the model sees more pixel detail; worth having regardless of the
  thinking-budget fix, since small in-game text and script glyphs (Arabic
  diacritics especially) are exactly what benefits from this. (Typed as
  `as never` here only because this SDK version's TS enum for this field
  may not have that exact literal exported the same way `FinishReason`
  does — if `tsc`/build fails on this line, swap it for the SDK's actual
  `MediaResolution.MEDIA_RESOLUTION_HIGH` enum import instead of the
  string literal; functionally identical, just import it from `@google/genai`.)
- The `finishReason === "MAX_TOKENS"` check turns a **silent wrong-but-
  parseable name** into a thrown error — which `classify()`/`extract()`'s
  existing `catch` blocks in `lib/pipeline/run.ts` already turn into a
  proper `needs_review` row instead of a committed bad record. This is the
  part that lets you actually *prove* whether this was the cause: if it
  recurs after this ships, the needs_review message will now say
  `thoughtsTokenCount=...` instead of just silently having a half name.

This applies to both `classify()` and `extract()` since both go through
`generateJson()` — no other file needs to change for this half of the fix.

## Root cause 2: the fuzzy-match distance function isn't Unicode-safe

`lib/pipeline/matchMemberCore.ts`'s `levenshtein()` (lines 33-44) and the
`threshold` calculation (line 71) both operate on raw JS string
indexing/`.length`, which counts **UTF-16 code units**, not actual
characters. For any name containing a character outside the Basic
Multilingual Plane — most emoji (the extraction prompt itself explicitly
tells the model names "may contain unusual characters/emoji"), and some
non-Latin script characters — a single visual character is stored as a
*surrogate pair* (2 code units). Indexing `a[i-1]` on a string like that
doesn't give you that character, it gives you one meaningless half of it,
which corrupts both the string length used for the match threshold and
every distance calculation involving that character. This isn't a
theoretical concern — normal Levenshtein-on-a-JS-string always has this
bug, and it's exactly the kind of thing that quietly makes "the same
person, read again" register as a bigger edit distance than it should for
some members and not others, depending on whether their name happens to
contain an astral-plane character.

### Fix — `lib/pipeline/matchMemberCore.ts`

```ts
function levenshtein(a: string, b: string): number {
  const aChars = Array.from(a);
  const bChars = Array.from(b);
  const dp: number[][] = Array.from({ length: aChars.length + 1 }, () => new Array(bChars.length + 1).fill(0));
  for (let i = 0; i <= aChars.length; i++) dp[i][0] = i;
  for (let j = 0; j <= bChars.length; j++) dp[0][j] = j;
  for (let i = 1; i <= aChars.length; i++) {
    for (let j = 1; j <= bChars.length; j++) {
      const cost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[aChars.length][bChars.length];
}
```

`Array.from(str)` iterates by Unicode code point (correctly pairs up
surrogate pairs into single entries), unlike `str.length`/`str[i]` which
don't. Then update the threshold line to count code points the same way:

```ts
// line 71, was: Math.round(normalized.length * MATCH_THRESHOLD_RATIO)
const threshold = Math.max(1, Math.round(Array.from(normalized).length * MATCH_THRESHOLD_RATIO));
```

No other lines in this file need to change — `normalize()` already uses
`\p{L}`/`\p{N}` Unicode property escapes, which are already script-agnostic
and correct.

## What this does *not* claim to fix

I don't have a real side-by-side to prove thinking-token truncation is
100% of what you've been seeing versus the model occasionally just
misreading a stylized game font — that second failure mode is real for any
vision model and no code change eliminates it outright. What this spec
fixes is: (a) the specific, well-documented way Gemini 2.5 can silently
hand back a truncated-but-valid name instead of failing loudly, and (b) a
real Unicode bug in the matching code that would cause spurious
non-matches independent of what the AI actually read. Both are concrete
and worth shipping regardless of how much they turn out to explain.

## Bump the version number

`lib/version.ts` — check the current `MINOR` value at implementation time
(it may have moved since this spec was written, e.g. if the Vercel import
fix already shipped) and increment by 1 from whatever it currently is.

## Test plan

1. Re-run a handful of screenshots you know previously produced a cut-off
   or duplicate-causing name — ideally including at least one large roster
   screenshot and one with non-Latin names.
2. Check `/raw` (admin-only, unlinked page) and the `/review` queue for
   any `needs_review`/error entries — if truncation is still happening,
   the error message will now include `thoughtsTokenCount`/
   `candidatesTokenCount`, which tells you whether `maxOutputTokens: 8192`
   needs to go even higher for your biggest screenshots.
3. Check whether previously-duplicated members stop re-duplicating on
   their next weekly screenshot (this validates fix 2, separately from
   fix 1 — a name can be read perfectly and still fail to match if it has
   an emoji or astral-plane character in it).
