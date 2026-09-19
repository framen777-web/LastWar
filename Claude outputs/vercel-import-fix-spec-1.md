# Fix: Import fails on Vercel with "Unexpected end of JSON input"

For the Claude Code session on Frans's machine. Read the referenced files
before applying — they are quoted here from the live repo as of this spec's
writing, but re-confirm nothing has moved since.

## Root cause (confirmed by reading the live source)

`app/api/upload/route.ts` (the `/api/upload` route behind the Import screen)
writes every uploaded screenshot to local disk before doing anything else:

```ts
// app/api/upload/route.ts, lines 23-24, 30
const uploadsDir = path.join(process.cwd(), "public", "uploads");
await mkdir(uploadsDir, { recursive: true });
...
await writeFile(path.join(uploadsDir, safeName), buffer);
```

This worked on Render because Render web services run as a normal persistent
Node process with a writable filesystem. **Vercel serverless functions have a
read-only filesystem except `/tmp`.** `mkdir`/`writeFile` outside `/tmp`
throws `EROFS: read-only file system` immediately, before
`runPipelineForImage` (and therefore Gemini/Postgres) is ever reached. The
uncaught throw inside the route handler crashes the function invocation
before any response body is written, so the browser's `fetch` resolves to a
response with an empty body — which is exactly why `res.json()` fails with
"Unexpected end of JSON input" for every single file, every time, with no
per-image variation. That matches what you saw: 3 of 3 failed identically.

This is why it's Vercel-specific and wasn't a problem on Render — it isn't a
sizing, timeout, or Gemini-quota issue, it's the disk write itself.

**One consumer depends on that saved file**: `app/raw/page.tsx` (an
unlinked, admin-only `/raw` audit page) renders a thumbnail from it:

```tsx
// app/raw/page.tsx, line 30
{ex.imageFilename.startsWith("/uploads/") && (
  <img src={ex.imageFilename} ... />
)}
```

Nothing else reads the saved path back (`/review` only shows the parsed
table data, not the source image; `/api/upload`'s own response never uses
the path itself, just the label). So the fix needs a storage location that
(a) is writable from a Vercel function and (b) is actually servable back as
an `<img src>` afterward — local disk can't do either on Vercel.

The season-extras upload path (`app/api/seasons/[id]/upload-extras/route.ts`
→ `lib/pipeline/runSeasonExtra.ts`) does **not** have this bug — it never
touches the filesystem, it just passes `file.name` straight through as a
label. No change needed there.

## Fix: store the screenshot in Vercel Blob instead of local disk

Vercel Blob is the native object-storage product for exactly this — a
serverless function can write to it, and it returns a public URL you can
put straight into `<img src>`. No new external service/account needed
beyond enabling it on this Vercel project.

### 1. One-time step in the Vercel dashboard (not a code change)

In the Vercel project → **Storage** tab → **Create Database** → **Blob** →
connect it to this project. This automatically adds a
`BLOB_READ_WRITE_TOKEN` environment variable to the project — no manual env
var entry needed.

### 2. Install the package

```
npm install @vercel/blob
```

### 3. Edit `app/api/upload/route.ts`

Replace the whole file with:

```ts
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { runPipelineForImage } from "@/lib/pipeline/run";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const formData = await request.formData();

  const weekNumber = Number(formData.get("weekNumber"));
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "Invalid weekNumber" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const results = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = `${Date.now()}-${sanitizeFilename(file.name)}`;

    const blob = await put(safeName, buffer, {
      access: "public",
      contentType: file.type || "image/png",
    });

    const result = await runPipelineForImage({
      filename: blob.url,
      buffer,
      mimeType: file.type || "image/png",
      weekNumber,
    });
    results.push(result);
  }

  return NextResponse.json({ results });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
```

What changed: dropped the `fs/promises` (`mkdir`, `writeFile`) and `path`
imports and the local-disk write entirely; added `put()` from `@vercel/blob`,
which uploads the same buffer and returns a real public URL. That URL is
passed as `filename` into `runPipelineForImage` exactly where
`/uploads/${safeName}` used to go — everything downstream (`RawExtraction.
imageFilename`, the Upload results list, `/review`) already just treats
`filename` as an opaque string, so nothing else needs to change there.

### 4. Bump the version number

`lib/version.ts` — this counts as a change worth marking, so bump `MINOR`
by 1 as part of this commit (per that file's own comment):

```ts
const MAJOR = 2;
const MINOR = 23;
```

### 5. Edit `app/raw/page.tsx`

Line 30 currently only recognizes the old local-disk path shape:

```tsx
{ex.imageFilename.startsWith("/uploads/") && (
```

Change to recognize a real URL instead (covers both old rows already in the
database from before this fix, which will just fail this check and skip the
thumbnail, and new Blob-backed rows):

```tsx
{/^https?:\/\//.test(ex.imageFilename) && (
```

No other lines in that file need to change.

## Checklist to verify on Vercel while you're in there (not code changes)

_(Test plan below now also confirms the version bump landed — check the app header shows the new number after redeploying.)_

These aren't things I found broken, but `render.yaml`'s env vars don't carry
over to Vercel automatically, so worth a quick look before you retest:

- `DATABASE_URL` — if this was ever set to Render's Postgres **Internal**
  connection string (used when app + DB were both on Render, same region),
  it will not be reachable from Vercel at all. It needs to be the
  **External** Database URL from the Render Postgres dashboard.
- `APP_BASE_URL` — currently `https://alliance-stats-tracker.onrender.com`
  in `render.yaml`; on Vercel this should be set to the new `*.vercel.app`
  URL, since it's used to build the reset-password email link.
- `AUTH_SECRET`, `RESEND_API_KEY` — need to exist as Vercel env vars too
  (or `GEMINI_API_KEY` can stay DB-only via Setup → Settings, as before —
  that part is unaffected by the move).

## Test plan

1. Deploy the two file changes + `@vercel/blob` dependency.
2. Confirm the Blob store is connected on the Vercel project (Storage tab
   shows it, `BLOB_READ_WRITE_TOKEN` present under Environment Variables).
3. Re-run the exact import you just tried (week 68, same 3 screenshots).
   All 3 should now either commit, go to needs-review, or go to
   pending-confirmation — not fail with a JSON error.
4. Open `/raw` directly (it's admin-only, unlinked) and confirm the
   thumbnails render for the newly-imported rows.
