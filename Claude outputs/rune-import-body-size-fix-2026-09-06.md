# RUNE — Fix: import fails on 7+ files ("Unexpected token 'R', "Request En"... is not valid JSON")

This is a regression in the background-import redesign from the last spec (now live as
v02.0029) — my fault, not something new gone wrong on its own. Root cause and full fix
below.

## Root cause

"Request En..." is the front half of **"Request Entity Too Large"** — a plain-text/HTML
error page, not JSON. Your browser is getting that back from Vercel's platform layer, and
`UploadClient.tsx` then tries to `await res.json()` on it and throws exactly the error
you're seeing.

**Vercel Serverless Functions have a hard 4.5 MB request body limit** — not configurable,
not raisable in code. The redesigned `/api/import/start` bundles every selected file into
one multipart request so the import survives the tab going away. That's fine for a small
batch, but a handful of full-size phone screenshots (often 1-2MB+ each once you're on a
newer/high-res phone) crosses 4.5MB combined well before 15 files — commonly somewhere
around 5-8 files, matching exactly what you're seeing ("smaller groups work fine, 7+
doesn't").

## The real fix (Vercel's own recommended pattern for this exact problem)

Don't route file bytes through our own function at all. Upload each screenshot **directly
from the browser to Vercel Blob** using `@vercel/blob/client`'s `upload()` — the bytes
never touch our 4.5MB-limited function, so this removes the ceiling entirely regardless of
file count or size (up to Blob's own limits, which are far higher). Our server only ever
sees small JSON after that: a short-lived upload token request, then a tiny "here's the
blob URL for file X" registration call per file. This is Vercel's own documented fix for
this exact error, not a workaround I'm improvising — no new dependency needed,
`@vercel/blob` (already in your `package.json`, v2.8.0) has included this since early
versions.

New flow:
1. Client calls `POST /api/import/start` with just `{ weekNumber, totalFiles }` (tiny
   JSON) — creates the `ImportJob` row, returns `{ jobId }`.
2. For each file (a few at a time, not all 15 at once, to keep a phone's upload
   well-behaved), the client uploads straight to Blob via `upload()`, then calls
   `POST /api/import/[jobId]/items` with `{ filename, blobUrl, mimeType }` (tiny JSON) to
   register it — this is what actually creates the `ImportJobItem` row and nudges
   processing forward.
3. Everything else from the last spec is unchanged: `after()` keeps processing running
   after the response is sent, `/api/import/resume` (cron + on-mount) picks up anything
   left mid-batch, the status poll and cancel button work the same way.

This also needed one correctness fix while I was in there: `processImportJob` used to
decide "this job is done" by checking whether any `ImportJobItem` rows were still
un-done. With items now arriving one at a time as uploads finish (rather than all at once
up front), that check could fire while some files hadn't even been uploaded yet - it now
compares against the job's own `totalFiles`/`processedFiles` counters instead, which are
known correctly from the very first `/api/import/start` call.

## Change 1 — `prisma/schema.prisma`: drop the `order` column on `ImportJobItem`

The `order` field (and its `@@unique([importJobId, order])`) was only ever there to record
upload sequence — items are added one at a time now as each browser upload finishes, so
two uploads landing at the same instant could both try to claim the same `order` value and
collide on that unique constraint for no real benefit (nothing actually needs a strict
order any more; `id` already reflects arrival order for display purposes). Remove it.

In the `ImportJobItem` model, delete this line:

```prisma
  order        Int
```

and delete this line:

```prisma
  @@unique([importJobId, order])
```

The model should read:

```prisma
model ImportJobItem {
  id           Int       @id @default(autoincrement())
  importJobId  Int
  importJob    ImportJob @relation(fields: [importJobId], references: [id])
  filename     String
  blobUrl      String
  mimeType     String
  status       String    @default("queued") // "queued" | "processing" | "done"
  categoryKey  String?
  confidence   Float?
  resultStatus String? // "committed" | "needs_review" | "pending_confirmation" | "error" - set once status is "done"
  errorMessage String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([importJobId, status])
}
```

Then:

```
npx prisma db push
npx prisma generate
```

## Change 2 — `lib/importJob.ts`, full replacement

```ts
import { prisma } from "@/lib/db";
import { runPipelineForImage } from "@/lib/pipeline/run";

/**
 * Works through an ImportJob's queued items one at a time until either the whole job is
 * done (processedFiles has caught up to totalFiles), the job's own status has moved off
 * "processing" (cancelled elsewhere), deadlineMs is reached, or there's simply nothing
 * queued to do RIGHT NOW. That last case matters because items can still be arriving one
 * at a time from the browser's in-flight uploads (see app/api/import/[jobId]/items) - this
 * just returns rather than marking the job complete, and the next /items call (or the
 * resume cron, if the browser goes away mid-upload) picks it back up.
 *
 * Safe to call concurrently for the same job (e.g. two /items calls landing close
 * together, or a resume() cron tick overlapping an after() callback): each item is claimed
 * with a conditional update before being processed, so only one caller ever actually runs
 * the pipeline for a given item. Always re-fetches the image from its stored Blob URL
 * rather than assuming the caller still has the original bytes in memory - this function
 * may run in a completely different invocation than the one that registered the item.
 */
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

    try {
      const res = await fetch(next.blobUrl);
      if (!res.ok) throw new Error(`Could not re-fetch staged image from Blob (HTTP ${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const result = await runPipelineForImage({
        filename: next.blobUrl,
        buffer,
        mimeType: next.mimeType,
        weekNumber: job.weekNumber,
      });

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
```

## Change 3 — `app/api/import/start/route.ts`, full replacement

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { weekNumber?: number; totalFiles?: number };
  const weekNumber = Number(body.weekNumber);
  const totalFiles = Number(body.totalFiles);

  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "Invalid weekNumber" }, { status: 400 });
  }
  if (!Number.isInteger(totalFiles) || totalFiles < 1) {
    return NextResponse.json({ error: "Invalid totalFiles" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: { weekNumber, status: "processing", totalFiles },
  });

  return NextResponse.json({ jobId: job.id });
}
```

(No more `put()`/Blob import here, no more `maxDuration` export needed either — this route
no longer touches file bytes or calls `after()`, it just creates a row.)

## Change 4 — new file `app/api/import/blob-upload/route.ts`

This is the token-minting endpoint the browser's `upload()` call talks to before sending
bytes straight to Blob. Its own request body is tiny (just the filename/content-type being
requested), so it's nowhere near the 4.5MB limit itself.

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - matches UploadClient's own client-side check

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_MIME_TYPES,
        maximumSizeInBytes: MAX_FILE_SIZE,
      }),
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
```

## Change 5 — new file `app/api/import/[jobId]/items/route.ts`

```ts
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { processImportJob } from "@/lib/importJob";

export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/import/[jobId]/items">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const jobId = Number((await ctx.params).jobId);
  const body = (await request.json()) as { filename?: string; blobUrl?: string; mimeType?: string };
  if (!body.filename || !body.blobUrl || !body.mimeType) {
    return NextResponse.json({ error: "filename, blobUrl and mimeType are required" }, { status: 400 });
  }

  await prisma.importJobItem.create({
    data: { importJobId: jobId, filename: body.filename, blobUrl: body.blobUrl, mimeType: body.mimeType, status: "queued" },
  });

  // Same reasoning as /api/import/start had before: runs after this response is already
  // sent, so it doesn't depend on the browser tab. Called once per file as uploads finish,
  // so the first few files are already being processed while the rest are still uploading.
  after(() => processImportJob(jobId, Date.now() + 50_000));

  return NextResponse.json({ ok: true });
}
```

## Change 6 — `app/api/import/[jobId]/status/route.ts`, one-line change

Change:

```ts
    include: { items: { orderBy: { order: "asc" } } },
```

to:

```ts
    include: { items: { orderBy: { id: "asc" } } },
```

(`order` no longer exists on the model — `id` already reflects arrival order.)

## Change 7 — `app/upload/UploadClient.tsx`, rewrite `handleSubmit` and add the uploader helper

Add this import at the top, alongside the existing ones:

```ts
import { upload } from "@vercel/blob/client";
```

Add this helper function above the `UploadClient` component (after the existing consts,
before `export function UploadClient()`):

```ts
const UPLOAD_CONCURRENCY = 3;

async function uploadFilesToJob(files: File[], jobId: number): Promise<{ filename: string; error: string }[]> {
  const queue = [...files];
  const failures: { filename: string; error: string }[] = [];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) return;
      try {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/import/blob-upload",
        });
        const res = await fetch(`/api/import/${jobId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, blobUrl: blob.url, mimeType: file.type || "image/png" }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        failures.push({ filename: file.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () => worker()));
  return failures;
}
```

Replace the existing `handleSubmit` function body with:

```ts
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;

    setSubmitting(true);
    setError(null);
    setJob(null);
    setJobId(null);
    setBlock(true, LEAVE_WARNING);

    try {
      const startRes = await fetch("/api/import/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekNumber, totalFiles: files.length }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error ?? `HTTP ${startRes.status}`);

      const newJobId: number = startData.jobId;
      setJobId(newJobId); // status polling starts immediately - items will appear as each upload finishes

      const failures = await uploadFilesToJob(files, newJobId);
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${files.length} file(s) failed to upload:\n${failures
            .map((f) => `${f.filename}: ${f.error}`)
            .join("\n")}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      setBlock(false);
    }
  }
```

Nothing else in this file changes — the status-polling effect, cancel button, and results
list from the last spec are unaffected by this fix.

## Change 8 — version bump

`lib/version.ts`: bump `MINOR` from `29` to `30`.

## Deploy checklist

1. Apply the schema change (Change 1), then `npx prisma db push && npx prisma generate`.
2. Apply changes 2-7.
3. Bump the version.
4. Deploy.
5. Confirm the header shows `02.0030`.
6. Re-test the exact case that broke: select 15 files (or whatever you had last time) and
   hit Upload & process — should no longer throw the JSON error, and you should see
   progress climb as files land.
7. Also re-test the "leave the screen mid-import" case from the last spec, since the
   upload phase itself is different now (per-file direct-to-Blob calls instead of one big
   request) — background/backgrounding mid-upload should still result in the import
   finishing once you come back or the resume cron ticks, same guarantee as before.
