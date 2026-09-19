# RUNE — Feature: upload a screen recording instead of individual screenshots

This is a bigger, riskier change than the last few specs — new external API surface
(Gemini's video understanding + File API), a schema change, and real unknowns around cost
and processing time. Read the "Before you build this" section first; it's not just
boilerplate caution, there are two things worth deciding up front.

Confirmed live version is `v02.0032`. This spec bumps to `33`.

## What this adds

Right now Import only accepts JPEG/PNG/WebP screenshots — one file in, one category's
worth of rows out. This adds the option to instead upload a video (e.g. screen-recording
yourself scrolling through the Kills, VS, Donations, DS rankings and the roster screen one
after another). The system:

1. Uploads the whole video to Gemini once (via its File API, not inline in the request —
   videos are much bigger than a screenshot).
2. Asks Gemini to scan the video and report every distinct data screen it can identify,
   with a confidence score and the time range (in seconds) during which that screen is
   fully visible and readable.
3. For each screen found, re-uses the exact same extraction prompts/schemas your
   screenshots already use, just pointed at that clipped time range of the video instead
   of a still image.
4. Writes the results exactly like today — each detected screen shows up as its own row in
   the Import page's results list and, if it needs review, in the Review queue, same as if
   you'd uploaded that many separate screenshots.

You can still upload plain screenshots too — this is additive, not a replacement.

## Before you build this — two things to decide first

**1. Cost.** Gemini bills video by tokens-per-second of footage, not per-image the way
screenshots are billed — a 30-second recording costs meaningfully more than one screenshot,
and unlike the screenshot pricing questions from earlier in this conversation, I don't have
a verified current per-second video rate to give you here. Test with one short recording of
your own after this deploys, then check the token/cost numbers on your Google AI
Studio/Vertex usage dashboard before telling the rest of the alliance to switch to video.

**2. Vercel function time limit.** Uploading a video to Gemini, waiting for it to finish
processing server-side, running the scan, then running one extraction call per screen found
— all of that has to fit inside your Vercel function's `maxDuration`. The existing import
code already handles "ran out of time" by doing some work then returning (the external
resume cron picks up the rest), so nothing breaks if this runs long — but a video import
will realistically take several resume-cron ticks to finish rather than completing in one
go, especially if you're on Vercel's Hobby plan (60s hard cap; Pro allows up to 300s). This
spec raises `maxDuration` to 120s on the two routes that need it — bump it further if your
plan allows and you want fewer resume-cron round trips.

## Change 1 — schema: `prisma/schema.prisma`

`ImportJobItem` needs a few new nullable columns to support a video item "expanding" into
one sub-item per detected screen, and one new `resultStatus` value for the original video
item once it's been expanded (so it doesn't render as a normal result row).

Update the model (currently lines 184-200):

```prisma
model ImportJobItem {
  id             Int       @id @default(autoincrement())
  importJobId    Int
  importJob      ImportJob @relation(fields: [importJobId], references: [id])
  filename       String
  blobUrl        String
  mimeType       String
  status         String    @default("queued") // "queued" | "processing" | "done"
  categoryKey    String?
  confidence     Float?
  resultStatus   String? // "committed" | "needs_review" | "pending_confirmation" | "error" | "expanded" - set once status is "done"
  errorMessage   String?
  geminiFileUri  String?  // Gemini File API uri for the source video - set once uploaded, reused by every segment expanded from it
  videoClipStart Float?   // seconds - set only on a segment expanded from a video (null for a plain screenshot or an un-expanded video)
  videoClipEnd   Float?   // seconds
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([importJobId, status])
}
```

Run `npx prisma db push` then `npx prisma generate` (no migrations folder in this project,
per existing convention).

## Change 2 — `lib/ai/gemini.ts`: video-capable Gemini calls

Add two new exports alongside the existing `generateJson`. Full file after the change:

```ts
import { GoogleGenAI, MediaResolution } from "@google/genai";
import { getGeminiApiKey } from "@/lib/settings";

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

async function buildClient(): Promise<GoogleGenAI> {
  // Built per call (not a module-level singleton) so a key saved via Setup -> Settings
  // takes effect immediately, without needing an env var + redeploy.
  const apiKey = await getGeminiApiKey();
  return new GoogleGenAI({ apiKey });
}

function checkResponse(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>): string {
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
  return text;
}

export async function generateJson(params: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  schema: unknown;
}): Promise<unknown> {
  const genai = await buildClient();

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

  return JSON.parse(checkResponse(response));
}

/**
 * Uploads a video's bytes to Gemini's File API and waits for it to finish server-side
 * processing before returning - a freshly uploaded video isn't immediately usable in a
 * generateContent call (state starts "PROCESSING"), unlike inline image data. Files expire
 * 48 hours after upload, which is fine here since a job is expected to finish the same day.
 */
export async function uploadVideoToGemini(buffer: Buffer, mimeType: string): Promise<{ fileUri: string; mimeType: string }> {
  const genai = await buildClient();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });

  let file = await genai.files.upload({ file: blob, config: { mimeType } });
  const deadline = Date.now() + 30_000;
  while (file.state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Gemini took too long to finish processing this video upload.");
    await new Promise((r) => setTimeout(r, 2000));
    file = await genai.files.get({ name: file.name! });
  }
  if (file.state !== "ACTIVE" || !file.uri) {
    throw new Error(`Gemini file upload did not become usable (state: ${file.state ?? "unknown"}).`);
  }
  return { fileUri: file.uri, mimeType: file.mimeType ?? mimeType };
}

/**
 * Same as generateJson, but for a video already uploaded via uploadVideoToGemini. `clip`
 * restricts the model's attention to one time range within the video - used per-segment so
 * a big multi-screen recording doesn't need to be re-uploaded once per screen, only
 * re-referenced with a different clip each time. Omit `clip` to let it look at the whole
 * video (used by the segment-scan step).
 */
export async function generateJsonFromVideo(params: {
  prompt: string;
  fileUri: string;
  mimeType: string;
  schema: unknown;
  clip?: { startSeconds: number; endSeconds: number };
}): Promise<unknown> {
  const genai = await buildClient();

  const videoPart: Record<string, unknown> = {
    fileData: { fileUri: params.fileUri, mimeType: params.mimeType },
  };
  if (params.clip) {
    videoPart.videoMetadata = {
      startOffset: `${params.clip.startSeconds}s`,
      endOffset: `${params.clip.endSeconds}s`,
    };
  }

  const response = await genai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [videoPart, { text: params.prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: params.schema,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 8192,
    },
  });

  return JSON.parse(checkResponse(response));
}
```

Note: `checkResponse` is just the existing truncation/empty-text check from the current
`generateJson`, pulled out so both the image and video paths share it instead of drifting
apart over time.

## Change 3 — `lib/ai/prompts.ts`: the segment-scan prompt

Add these two exports (near `buildClassifyPrompt`/`buildClassifySchema`):

```ts
export function buildVideoScanPrompt(categories: CategoryForPrompt[]): string {
  const lines = categories.map((c) => `- "${c.key}": ${c.description?.trim() || c.name}`).join("\n");

  return `This is a screen recording from a mobile alliance-strategy game - most likely someone scrolling through one or more ranking/roster screens one after another. Identify every distinct data screen that appears, matching each to exactly one of the following categories by its on-screen LAYOUT and SHAPE (not by matching specific English words, since some clients are localized):

${lines}

For each distinct screen you can identify, report the time range (in seconds from the start of the video) during which that screen is fully visible, settled, and readable - i.e. after any scroll/transition animation has finished and before the next screen starts appearing, so a single still frame anywhere in that range would be enough to read every row on it. If the same category's screen appears more than once (e.g. the person scrolled back to it later), report each occurrence as its own separate segment - do not merge them. If a portion of the video doesn't confidently match any of these categories, skip it rather than guessing. Always return a confidence score between 0 and 1 for each segment you do report.`;
}

export function buildVideoScanSchema(categories: CategoryForPrompt[]): unknown {
  return {
    type: "object",
    properties: {
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category_key: { type: "string", description: `One of: ${categories.map((c) => c.key).join(", ")}` },
            start_seconds: { type: "number" },
            end_seconds: { type: "number" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["category_key", "start_seconds", "end_seconds", "confidence"],
        },
      },
    },
    required: ["segments"],
  };
}
```

## Change 4 — `lib/ai/classify.ts`: scanning a video into segments

Add this export alongside the existing `classify()`:

```ts
import { buildVideoScanPrompt, buildVideoScanSchema } from "./prompts";
import { generateJsonFromVideo } from "./gemini";

export type VideoSegment = { categoryKey: string; startSeconds: number; endSeconds: number; confidence: number };

export async function classifyVideoSegments(fileUri: string, mimeType: string): Promise<VideoSegment[]> {
  const categories: CategoryForPrompt[] = await prisma.category.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  if (categories.length === 0) return [];

  const raw = (await generateJsonFromVideo({
    prompt: buildVideoScanPrompt(categories),
    fileUri,
    mimeType,
    schema: buildVideoScanSchema(categories),
  })) as { segments?: unknown[] };

  return (raw.segments ?? [])
    .map((s) => s as { category_key?: unknown; start_seconds?: unknown; end_seconds?: unknown; confidence?: unknown })
    .filter((s) => typeof s.category_key === "string" && typeof s.start_seconds === "number" && typeof s.end_seconds === "number")
    .map((s) => ({
      categoryKey: s.category_key as string,
      startSeconds: s.start_seconds as number,
      endSeconds: s.end_seconds as number,
      confidence: typeof s.confidence === "number" ? s.confidence : 0,
    }));
}
```

(Add the two new imports at the top of the file alongside the existing ones — don't
duplicate `generateJson` import, it's still used by `classify()`.)

## Change 5 — `lib/ai/extract.ts`: extracting from a clipped video segment

The existing `extract()` builds the raw Gemini result then, for `free_text` categories
only, runs it through `resolveSquadMember`. Pull that shared bit out so both the image and
video paths use it identically:

```ts
import { generateJson, generateJsonFromVideo } from "./gemini";
import { buildExtractionPrompt, getExtractionSchema, type CategoryForPrompt } from "./prompts";
import { resolveSquadMember, type RawSquadValue } from "./resolveSquadValues";

// ...existing type exports unchanged...

type RawFreeTextResult = { members: Array<{ member_name: string; values: RawSquadValue[] }> };

function shapeResult(category: CategoryForPrompt, raw: unknown): RankingListResult | RosterResult | FreeTextResult {
  if (category.shape === "free_text") {
    const r = raw as RawFreeTextResult;
    return {
      members: (r.members ?? []).map((m) => resolveSquadMember(m.member_name, m.values ?? [])),
    };
  }
  return raw as RankingListResult | RosterResult;
}

export async function extract(
  category: CategoryForPrompt,
  imageBase64: string,
  mimeType: string
): Promise<RankingListResult | RosterResult | FreeTextResult> {
  const result = await generateJson({
    prompt: buildExtractionPrompt(category),
    imageBase64,
    mimeType,
    schema: getExtractionSchema(category.shape),
  });
  return shapeResult(category, result);
}

export async function extractFromVideo(
  category: CategoryForPrompt,
  fileUri: string,
  mimeType: string,
  clip: { startSeconds: number; endSeconds: number }
): Promise<RankingListResult | RosterResult | FreeTextResult> {
  const result = await generateJsonFromVideo({
    prompt: buildExtractionPrompt(category),
    fileUri,
    mimeType,
    schema: getExtractionSchema(category.shape),
    clip,
  });
  return shapeResult(category, result);
}
```

(Leave the existing type exports — `RankingRow`, `RankingListResult`, `RosterResult`,
`FreeTextResult` — exactly where they are; only the body changes as shown.)

## Change 6 — `lib/pipeline/run.ts`: writing a video segment's result

`runPipelineForImage` currently does classify → check confidence/category → extract →
write. For a video segment, the category and confidence are already known (from the scan
step) — only the extract-and-write half applies. Pull that half into a shared helper so the
two entry points can't drift apart on how a result gets written:

Replace the body of `runPipelineForImage` (currently lines 20-88) with:

```ts
export async function runPipelineForImage(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  weekNumber: number;
}): Promise<PipelineResult> {
  const imageBase64 = params.buffer.toString("base64");

  let categoryKey = "unknown";
  let confidence = 0;
  try {
    const classifyResult = await classify(imageBase64, params.mimeType);
    categoryKey = classifyResult.categoryKey;
    confidence = classifyResult.confidence;
  } catch (err) {
    await createNeedsReview(params.filename, "unknown", params.weekNumber, 0);
    return { filename: params.filename, categoryKey: "unknown", confidence: 0, status: "error", message: describeError(err) };
  }

  return commitCategoryResult(params.filename, categoryKey, confidence, params.weekNumber, (category) =>
    extract(category, imageBase64, params.mimeType)
  );
}

/**
 * Same as runPipelineForImage, but for one segment already identified by
 * classifyVideoSegments - categoryKey/confidence are known up front, so there's no
 * classify() call, just the same confidence/category checks and extract-and-write logic
 * every image result already goes through.
 */
export async function runPipelineForVideoSegment(params: {
  filename: string;
  fileUri: string;
  mimeType: string;
  categoryKey: string;
  confidence: number;
  clip: { startSeconds: number; endSeconds: number };
  weekNumber: number;
}): Promise<PipelineResult> {
  return commitCategoryResult(params.filename, params.categoryKey, params.confidence, params.weekNumber, (category) =>
    extractFromVideo(category, params.fileUri, params.mimeType, params.clip)
  );
}

async function commitCategoryResult(
  filename: string,
  categoryKey: string,
  confidence: number,
  weekNumber: number,
  runExtract: (category: Category) => Promise<RankingListResult | RosterResult | FreeTextResult>
): Promise<PipelineResult> {
  if (categoryKey === "unknown" || confidence < CONFIDENCE_THRESHOLD) {
    await createNeedsReview(filename, categoryKey, weekNumber, confidence);
    return { filename, categoryKey, confidence, status: "needs_review" };
  }

  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !category.active) {
    await createNeedsReview(filename, categoryKey, weekNumber, confidence);
    return { filename, categoryKey, confidence, status: "needs_review" };
  }

  try {
    const extracted = await runExtract(category);

    if (category.shape === "free_text") {
      await prisma.rawExtraction.create({
        data: {
          imageFilename: filename,
          categoryKey,
          weekNumber,
          rawJson: JSON.stringify(extracted),
          confidence,
          status: "pending_confirmation",
        },
      });
      return { filename, categoryKey, confidence, status: "pending_confirmation" };
    }

    await prisma.rawExtraction.create({
      data: { imageFilename: filename, categoryKey, weekNumber, rawJson: JSON.stringify(extracted), confidence, status: "committed" },
    });
    await writeExtraction(category, extracted, weekNumber);
    return { filename, categoryKey, confidence, status: "committed" };
  } catch (err) {
    await createNeedsReview(filename, categoryKey, weekNumber, confidence);
    return { filename, categoryKey, confidence, status: "error", message: describeError(err) };
  }
}
```

Update the import line at the top of the file to add the new extract import:

```ts
import { extract, extractFromVideo, type FreeTextResult, type RankingListResult, type RosterResult } from "@/lib/ai/extract";
```

Everything else in `run.ts` (`createNeedsReview`, `describeError`, `writeExtraction`, and
everything below it) is unchanged.

## Change 7 — `lib/importJob.ts`: the three kinds of item

`processImportJob`'s per-item handling currently assumes every claimed item is a plain
image. It now needs to branch three ways once an item is claimed:

- a plain screenshot → unchanged, calls `runPipelineForImage`
- a freshly uploaded video (`mimeType` starts with `video/` and `videoClipStart` is still
  null) → upload to Gemini, scan it, expand it into one queued sub-item per detected
  segment, mark the original item `"expanded"`
- a video segment (`videoClipStart` is set) → calls `runPipelineForVideoSegment`

Full file after the change:

```ts
import { prisma } from "@/lib/db";
import { runPipelineForImage, runPipelineForVideoSegment } from "@/lib/pipeline/run";
import { uploadVideoToGemini } from "@/lib/ai/gemini";
import { classifyVideoSegments } from "@/lib/ai/classify";

export async function processImportJob(jobId: number, deadlineMs: number): Promise<void> {
  while (true) {
    if (Date.now() > deadlineMs) return;

    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "processing") return;

    if (job.processedFiles >= job.totalFiles) {
      await prisma.importJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "completed" } });
      return;
    }

    const next = await prisma.importJobItem.findFirst({
      where: { importJobId: jobId, status: "queued" },
      orderBy: { id: "asc" },
    });
    if (!next) return;

    const claimed = await prisma.importJobItem.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "processing" },
    });
    if (claimed.count === 0) continue; // another invocation already claimed it

    const isFreshVideo = next.mimeType.startsWith("video/") && next.videoClipStart === null;
    const isVideoSegment = next.videoClipStart !== null;

    if (isFreshVideo) {
      await expandVideoItem(job.id, next);
    } else {
      try {
        const result = isVideoSegment
          ? await runPipelineForVideoSegment({
              filename: next.filename,
              fileUri: next.geminiFileUri!,
              mimeType: next.mimeType,
              categoryKey: next.categoryKey!,
              confidence: next.confidence ?? 0,
              clip: { startSeconds: next.videoClipStart!, endSeconds: next.videoClipEnd! },
              weekNumber: job.weekNumber,
            })
          : await (async () => {
              const res = await fetch(next.blobUrl);
              if (!res.ok) throw new Error(`Could not re-fetch staged image from Blob (HTTP ${res.status})`);
              const buffer = Buffer.from(await res.arrayBuffer());
              return runPipelineForImage({ filename: next.blobUrl, buffer, mimeType: next.mimeType, weekNumber: job.weekNumber });
            })();

        await prisma.importJobItem.update({
          where: { id: next.id },
          data: {
            status: "done",
            categoryKey: result.categoryKey,
            confidence: result.confidence,
            resultStatus: result.status,
            errorMessage: result.message ?? null,
          },
        });
      } catch (err) {
        await prisma.importJobItem.update({
          where: { id: next.id },
          data: { status: "done", resultStatus: "error", errorMessage: err instanceof Error ? err.message : String(err) },
        });
      }

      await prisma.importJob.update({ where: { id: jobId }, data: { processedFiles: { increment: 1 } } });
    }
  }
}

/**
 * Turns one freshly uploaded video item into N queued segment sub-items (one per screen
 * Gemini identifies in it) - the video item itself is then marked "expanded" rather than
 * going through the normal committed/needs_review/error outcomes, since it was never
 * itself a single category's data. totalFiles grows by the segment count so the progress
 * bar's denominator reflects what's actually left to do (it's normal for the bar to look
 * like it "jumps back" right after a video is scanned - that's this growing, not something
 * going wrong).
 */
async function expandVideoItem(
  jobId: number,
  item: { id: number; filename: string; blobUrl: string; mimeType: string }
): Promise<void> {
  try {
    const res = await fetch(item.blobUrl);
    if (!res.ok) throw new Error(`Could not re-fetch staged video from Blob (HTTP ${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const { fileUri, mimeType } = await uploadVideoToGemini(buffer, item.mimeType);
    const segments = await classifyVideoSegments(fileUri, mimeType);

    if (segments.length === 0) {
      await prisma.importJobItem.update({
        where: { id: item.id },
        data: { status: "done", resultStatus: "error", errorMessage: "No recognizable screens found in this video.", geminiFileUri: fileUri },
      });
      await prisma.importJob.update({ where: { id: jobId }, data: { processedFiles: { increment: 1 } } });
      return;
    }

    await prisma.$transaction([
      ...segments.map((seg, i) =>
        prisma.importJobItem.create({
          data: {
            importJobId: jobId,
            filename: `${item.filename} (segment ${i + 1}: ${seg.categoryKey})`,
            blobUrl: item.blobUrl,
            mimeType,
            status: "queued",
            categoryKey: seg.categoryKey,
            confidence: seg.confidence,
            geminiFileUri: fileUri,
            videoClipStart: seg.startSeconds,
            videoClipEnd: seg.endSeconds,
          },
        })
      ),
      prisma.importJobItem.update({
        where: { id: item.id },
        data: { status: "done", resultStatus: "expanded", geminiFileUri: fileUri },
      }),
      prisma.importJob.update({
        where: { id: jobId },
        data: { processedFiles: { increment: 1 }, totalFiles: { increment: segments.length } },
      }),
    ]);
  } catch (err) {
    await prisma.importJobItem.update({
      where: { id: item.id },
      data: { status: "done", resultStatus: "error", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    await prisma.importJob.update({ where: { id: jobId }, data: { processedFiles: { increment: 1 } } });
  }
}
```

## Change 8 — `app/api/import/blob-upload/route.ts`: accept video

```ts
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB - generous ceiling for a short screen recording; UploadClient enforces the tighter, type-specific limits users actually see
```

Nothing else in this file changes — `handleUpload`'s `onBeforeGenerateToken` already
returns these two constants as-is.

## Change 9 — `app/upload/UploadClient.tsx`: pick a video, see it processed

Update the constants near the top:

```ts
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB - a phone screenshot is a few MB at most
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB - generous for a minute or two of screen recording
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
```

(Replace the old `MAX_FILE_SIZE`/`ALLOWED_MIME_TYPES` constants with these four - update the
one other place `ALLOWED_MIME_TYPES`/`MAX_FILE_SIZE` was referenced, in the file-picker
`onChange` below.)

Add the new `"expanded"` status alongside the existing ones:

```ts
type ResultStatus = "committed" | "needs_review" | "pending_confirmation" | "error" | "expanded";
```

```ts
const STATUS_STYLES: Record<ResultStatus, string> = {
  committed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  pending_confirmation: "bg-blue-100 text-blue-800",
  error: "bg-red-100 text-red-800",
  expanded: "bg-neutral-100 text-neutral-600",
};

const STATUS_LABELS: Record<ResultStatus, string> = {
  committed: "committed",
  needs_review: "needs review — see Review",
  pending_confirmation: "needs your confirmation — see Review",
  error: "error — see Review",
  expanded: "split into segments below",
};
```

Update the file input (currently `accept="image/*"` with the inline validation loop):

```tsx
<input
  id="files"
  type="file"
  accept="image/*,video/*"
  multiple
  onChange={(e) => {
    const selected = Array.from(e.target.files ?? []);
    const valid: File[] = [];
    const rejections: string[] = [];

    for (const file of selected) {
      const isVideo = file.type.startsWith("video/");
      const allowedTypes = isVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

      if (!allowedTypes.includes(file.type)) {
        rejections.push(
          `${file.name}: unsupported type "${file.type || "unknown"}" (use JPEG/PNG/WebP for screenshots, or MP4/MOV/WebM for a recording)`
        );
      } else if (file.size > maxSize) {
        rejections.push(`${file.name}: ${Math.round(file.size / 1024 / 1024)}MB exceeds the ${Math.round(maxSize / 1024 / 1024)}MB limit`);
      } else {
        valid.push(file);
      }
    }

    setFiles(valid);
    setJob(null);
    setJobId(null);
    setError(rejections.length > 0 ? rejections.join("\n") : null);
  }}
  className="border border-neutral-300 rounded px-3 py-2"
/>
```

Update the label above it from "Screenshots" to "Screenshots or screen recording", and the
`uploadFilesToJob` body — POST body's `mimeType` fallback of `"image/png"` (line ~67) should
stay as-is, it's just a fallback for a browser that fails to report `file.type` for an
image, which won't apply to video files browsers do report a type for.

Finally, the results list already filters with `job?.items.filter((i) => i.status === "done")`
— that's unchanged and correct: an `"expanded"` item is `status: "done"` too, so it'll show
up in the list with its new "split into segments below" label rather than a category name,
which is the honest thing to show (it wasn't itself one category's data).

## Change 10 — raise `maxDuration` on the two routes that can now run long

`app/api/import/[jobId]/items/route.ts` and `app/api/import/resume/route.ts`:

```ts
export const maxDuration = 120;
```

(Raise further if your Vercel plan allows more than 120s and you'd rather have fewer
resume-cron round trips per video. Also bump the `Date.now() + 50_000` deadlines in both
files to leave the same ~10s safety margin under whatever `maxDuration` you choose - e.g.
`Date.now() + 110_000` for a 120s `maxDuration`.)

## Bump the version

`lib/version.ts`:

```ts
const MINOR = 33;
```

## Test

1. `npx prisma db push && npx prisma generate`, then deploy. Confirm the header shows
   `v02.0033`.
2. Record a short (10-20 second) screen recording on your phone of scrolling through 2-3
   ranking screens you already have categories for. Keep it short for this first test.
3. Upload it via Import. Watch the progress bar — it's expected to jump partway, then grow
   its denominator once the video finishes scanning (that's `totalFiles` increasing as
   segments are discovered, not a bug).
4. Check the results list: the original video file should show "split into segments below,"
   followed by one row per screen it found, each with its own category and confidence, same
   as a normal screenshot import.
5. Confirm the actual data landed correctly — spot-check one of the extracted categories
   against what's in the recording.
6. Try a recording that includes a screen with NO matching category (e.g. pause mid-scroll
   on a menu) — confirm it's correctly skipped rather than showing up as a bogus low-
   confidence segment.
7. Check your Google AI Studio (or Vertex) usage dashboard for what that one video actually
   cost in tokens, before doing this at real alliance-wide volume.
8. Re-confirm plain screenshot uploads still work exactly as before — this change is
   additive, nothing about the image path should have changed behavior.
