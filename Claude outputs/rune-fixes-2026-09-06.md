# RUNE (alliance-stats-tracker) — Two fixes: week-1 Kills for new members, and imports that survive you leaving

Read against the *actual current source* on 2026-09-06 (staged via the device bridge from
`C:\Users\Frans en Renet\source\repos\alliance-stats-tracker`). Exact file paths, exact
line numbers, exact code. Hand this whole file to the Claude Code session on your machine
to implement — it's self-contained.

Two independent fixes below; implement/deploy/version-bump them together as one change
(one bump to `lib/version.ts` covers both).

---

## Fix 1 — New member's first Kills reading shouldn't read as a giant week-1 gain

### What I found

Kills is a lifetime-cumulative reading (never resets in-game), so every place in the app
that shows "kills this week" has to convert the raw reading into a *gain* — the current
raw value minus the member's own previous raw reading. I checked every place that does
this conversion:

- `lib/conductor/stats.ts` (`getConductorCategoryWeekValues`, line 40) — already correct:
  a member's first-ever reading scores `0`, not the raw value. Conductor points are safe.
- `app/reports/leaderboard/page.tsx` (`getCategorySeries`, line 44-47) — already correct:
  a first-ever reading is dropped from the series entirely rather than shown as a gain.
- `app/reports/new-records/page.tsx` (`getNewRecords`, line 60-61) — same, already correct.
- `lib/dashboards/allianceDetail.ts` (`gain()`, line 122-127, used by the Summary table) —
  already correct: returns `undefined` when there's no prior reading, which
  `reduceOverRange` skips.
- `lib/dashboards/categoryGraph.ts` (`getGraphSeries`, line 117-127, the bar-chart data
  behind the Individual/Alliance Graphs pages) — already correct: no prior reading means
  no bar for that week (`hasData: false`).

So nowhere does the app actually *compute* the lifetime total as if it were earned in one
week — that part already works. The real gap is in the one place that displays the "no
prior reading" case to a person: **`lib/dashboards/individualGrowth.ts`**, used by
`/dashboards/individual/detail` (the per-member week-by-week table) and its Excel export.
A member's first tracked week currently renders the gain column as a blank "—", which
looks like missing/broken data rather than "this is intentional, they're new." That's what
you're seeing and correctly calling wrong even though the underlying number isn't
literally the lifetime total — it needs to explicitly say **New**, per your ask.

While fixing that display, I found a real related bug worth fixing at the same time (same
file, same root cause): the current code only looks at the *immediately preceding* week
the member has *any* stat for, not the nearest earlier week that specifically has a Kills
reading. A member who submits Kills in week 1, has no Kills screenshot in week 2 (but has
other categories that week), then submits again in week 3, currently gets a blank gain for
week 3 — it should be week3 − week1. Fixing "first reading → New" properly requires
walking back to the nearest actual prior reading for that category anyway, so this gets
fixed as part of the same change, not as scope creep.

### Change 1a — `lib/dashboards/individualGrowth.ts`

Replace the whole file (59 lines) with:

```ts
import { prisma } from "@/lib/db";

export type GrowthCategory = { key: string; name: string; cumulative: boolean };
export type GrowthRow = {
  week: number;
  /** categoryKey -> this week's stored value. */
  values: Record<string, number | undefined>;
  /**
   * categoryKey -> gain since the member's own previous reading (cumulative categories
   * only). "new" means this is the earliest week this member has ANY reading for that
   * specific category - there's no prior baseline to diff against, so the raw value (a
   * lifetime running total, e.g. Kills) must never be shown as if it were earned in this
   * one week. undefined means no reading at all this week.
   */
  gains: Record<string, number | "new" | undefined>;
};

export type MemberGrowthData = {
  member: { id: number; name: string; allianceRank: string | null } | null;
  categories: GrowthCategory[];
  /** Ascending by week. */
  rows: GrowthRow[];
};

// Shared by the Individual Dashboard page and its Excel export route, so the two can't
// drift out of sync on how a cumulative category's weekly gain is computed.
export async function getMemberGrowthData(memberId: number): Promise<MemberGrowthData> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, name: true, allianceRank: true },
  });

  const allCategories = await prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  // Squads (free_text) has no WeeklyStat value - same filter /dashboard uses.
  const categories: GrowthCategory[] = allCategories
    .filter((c) => c.shape !== "free_text")
    .map((c) => ({ key: c.key, name: c.name, cumulative: c.cumulative }));

  if (!member) return { member: null, categories, rows: [] };

  const stats = await prisma.weeklyStat.findMany({
    where: { memberId: member.id, categoryKey: { in: categories.map((c) => c.key) } },
    orderBy: { weekNumber: "asc" },
  });

  const weekNumbers = Array.from(new Set(stats.map((s) => s.weekNumber))).sort((a, b) => a - b);
  const valueByWeekCategory = new Map<string, number>();
  for (const s of stats) valueByWeekCategory.set(`${s.weekNumber}:${s.categoryKey}`, s.value);

  const rows: GrowthRow[] = weekNumbers.map((week, idx) => {
    const values: Record<string, number | undefined> = {};
    const gains: Record<string, number | "new" | undefined> = {};
    for (const c of categories) {
      const value = valueByWeekCategory.get(`${week}:${c.key}`);
      values[c.key] = value;
      if (c.cumulative && value !== undefined) {
        // Walk back to the nearest earlier week that actually has a reading for THIS
        // category - not just the member's immediately-preceding week overall, since a
        // member can skip a week for one category while still having other categories
        // recorded that week.
        let prev: number | undefined;
        for (let j = idx - 1; j >= 0; j--) {
          const candidate = valueByWeekCategory.get(`${weekNumbers[j]}:${c.key}`);
          if (candidate !== undefined) {
            prev = candidate;
            break;
          }
        }
        gains[c.key] = prev === undefined ? "new" : value - prev;
      }
    }
    return { week, values, gains };
  });

  return { member, categories, rows };
}
```

### Change 1b — `app/dashboards/individual/detail/page.tsx`

Replace lines 40-43:

```ts
  const valueRule = new Map(categories.map((c) => [c.key, pickNumberFormat(growthRows.map((r) => r.values[c.key]))]));
  const gainRule = new Map(
    categories.filter((c) => c.cumulative).map((c) => [c.key, pickNumberFormat(growthRows.map((r) => r.gains[c.key]))])
  );
```

with:

```ts
  const valueRule = new Map(categories.map((c) => [c.key, pickNumberFormat(growthRows.map((r) => r.values[c.key]))]));
  const gainRule = new Map(
    categories
      .filter((c) => c.cumulative)
      .map((c) => [
        c.key,
        pickNumberFormat(growthRows.map((r) => (typeof r.gains[c.key] === "number" ? (r.gains[c.key] as number) : undefined))),
      ])
  );
```

(`pickNumberFormat` only accepts `number | null | undefined` — the new `"new"` string
value has to be filtered out before it gets there, or this won't type-check.)

Replace lines 54-66:

```ts
      if (c.cumulative) {
        const gain = r.gains[c.key];
        cells[`${c.key}__gain`] =
          gain === undefined ? (
            <span className="text-neutral-400">—</span>
          ) : (
            <span className={gain >= 0 ? "text-green-600" : "text-red-600"}>
              {gain >= 0 ? "+" : ""}
              {formatWithRule(gain, gainRule.get(c.key)!)}
            </span>
          );
        if (gain !== undefined) sortValues[`${c.key}__gain`] = gain;
      }
```

with:

```ts
      if (c.cumulative) {
        const gain = r.gains[c.key];
        cells[`${c.key}__gain`] =
          gain === undefined ? (
            <span className="text-neutral-400">—</span>
          ) : gain === "new" ? (
            <span className="text-blue-600 text-xs font-medium">New</span>
          ) : (
            <span className={gain >= 0 ? "text-green-600" : "text-red-600"}>
              {gain >= 0 ? "+" : ""}
              {formatWithRule(gain, gainRule.get(c.key)!)}
            </span>
          );
        if (typeof gain === "number") sortValues[`${c.key}__gain`] = gain;
      }
```

### Change 1c — Excel export needs no code change

`app/api/dashboards/individual/export/route.ts` line 41 already does
`if (c.cumulative && r.gains[c.key] !== undefined) rowData[...] = r.gains[c.key]!` — once
`gains[c.key]` can be the string `"new"`, that condition already includes it (it's not
`undefined`), and `rowData`'s type (`Record<string, number | string>`) already accepts a
string. The exported spreadsheet will just show the text "New" in that cell for a
member's first tracked week. Nothing to change here — just confirming it doesn't break.

### What I deliberately did not touch

Leaderboard, New Records, the Alliance Summary Report, and the Graphs pages already
exclude a first-ever reading from gain-based math (see the audit above) — I didn't add a
"New" label to those too, since none of them currently misrepresent the number; a new
member's first week simply doesn't contribute to a ranking/record/sum yet, which is
correct. If you find you *also* want new members to show up explicitly as "New" in the
Kills Leaderboard's "This Week" panel (right now they're just absent that week), tell me
and I'll spec that separately — it's a different, more visible design change (adding rows
to a ranked list) than fixing a table cell.

---

## Fix 2 — Import must keep running when you switch apps or leave the screen

### Root cause

`app/upload/UploadClient.tsx` currently drives the whole import from the browser: a `for`
loop in client-side React state does one `fetch("/api/upload", ...)` per file, awaiting
each response before starting the next. Nothing about that loop survives independently of
the tab — it's a live JavaScript call stack sitting in your phone's browser. When you
switch to another app, mobile browsers aggressively throttle or fully suspend a
backgrounded tab's JavaScript (and under memory pressure can discard the page's JS state
entirely) — so the loop stalls or the whole in-progress import is lost, exactly what
you're seeing. The existing `beforeunload` handler only catches a real tab close/refresh;
it does nothing for "switched to another app while the browser stays open in the
background," which is the actual failure mode you described.

The "warn me before I leave" mechanism you want already exists in this codebase —
`components/NavigationBlocker.tsx` plus the `beforeunload` listener in `UploadClient.tsx`
— it already shows a confirm dialog for in-app navigation and a browser-native prompt for
tab close. The problem was never the warning; it's that leaving didn't actually mean "the
import keeps going," it just happened to sometimes still work if the fetch had already
gone out and the phone didn't suspend the tab, and sometimes didn't. The real fix is
architectural: the import can no longer depend on the browser tab being alive at all.

### Design

Move all real processing server-side, tracked in Postgres, decoupled entirely from the
browser:

1. The client uploads every selected file in **one** request to a new
   `POST /api/import/start`, which uploads each file to Vercel Blob (as today) and creates
   one `ImportJob` row plus one `ImportJobItem` row per file (status `"queued"`), then
   returns immediately with a `jobId`.
2. Real processing (classify → extract → write, the existing `runPipelineForImage`) runs
   **after** that response has already gone back to the browser, using Next's `after()` —
   this is what makes it not depend on the client anymore. It works through the queued
   items one at a time until either they're all done or the function's own time budget
   runs out.
3. If the function's time budget runs out mid-batch (a big import can outlast one
   invocation), anything still `"queued"` just sits there — a separate
   `POST /api/import/resume` endpoint finds any interrupted job and keeps going. This is
   called two ways: an external cron hitting it every couple of minutes (the actual
   guarantee that an import finishes even if you never reopen the app), and the Upload
   page firing it once on mount as a faster nudge for the common case of just reopening
   the app.
4. While the tab is open, `UploadClient` polls `GET /api/import/[jobId]/status` every
   1.5s to show live progress and results — purely cosmetic. If the tab is backgrounded,
   closed, or the phone switches apps, that polling just stops updating the screen; the
   import itself is completely unaffected, because it was never driven by that polling
   loop in the first place.
5. The navigation-blocker warning's wording is updated to say what's actually true now:
   leaving loses the live view, not the import.

This also means a big import (say 20+ screenshots) no longer needs your phone's browser to
stay in the foreground for the several minutes it can take — you can start it and walk
away.

Why `Promise.all` for the Blob uploads in step 1 rather than a loop: everything before the
response is sent eats into the same time budget `after()` needs afterward, so the
upload-to-Blob phase is parallelized (`Promise.all`) and the `ImportJobItem` rows are
written in one `createMany` call, rather than sequentially — for a typical batch of
screenshot-sized images this should take a few seconds total, not tens of seconds.

### Change 2a — `prisma/schema.prisma`

Insert immediately after the closing `}` of `model RawExtraction { ... }` (that block ends
at line 166):

```prisma
// One row per browser-initiated "Upload & process" submission. Exists so the actual
// per-image work (classify -> extract -> write) can run entirely server-side, decoupled
// from the browser tab that started it - a phone switching away to another app, or the
// tab being closed outright, no longer stops or restarts an import in progress. See
// lib/importJob.ts and app/api/import/*.
model ImportJob {
  id             Int             @id @default(autoincrement())
  weekNumber     Int
  status         String          @default("processing") // "processing" | "completed" | "cancelled"
  totalFiles     Int
  processedFiles Int             @default(0)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  items          ImportJobItem[]
}

model ImportJobItem {
  id           Int       @id @default(autoincrement())
  importJobId  Int
  importJob    ImportJob @relation(fields: [importJobId], references: [id])
  order        Int
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

  @@unique([importJobId, order])
  @@index([importJobId, status])
}
```

Then run (this project uses `db push`, not migration files — there's no `prisma/migrations`
folder, matching how the rest of the schema evolved):

```
npx prisma db push
npx prisma generate
```

### Change 2b — new file `lib/importJob.ts`

```ts
import { prisma } from "@/lib/db";
import { runPipelineForImage } from "@/lib/pipeline/run";

/**
 * Works through an ImportJob's queued items one at a time until either the job has none
 * left, the job's own status has moved off "processing" (cancelled elsewhere), or
 * deadlineMs is reached - whichever comes first. Safe to call concurrently for the same
 * job (e.g. an after() callback and a resume() cron tick overlapping): each item is
 * claimed with a conditional update before being processed, so only one caller ever
 * actually runs the pipeline for a given item.
 *
 * Always re-fetches the image from its stored Blob URL rather than assuming the caller
 * still has the original bytes in memory - this function may run in a completely
 * different invocation than the one that received the upload.
 */
export async function processImportJob(jobId: number, deadlineMs: number): Promise<void> {
  while (true) {
    if (Date.now() > deadlineMs) return;

    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "processing") return;

    const next = await prisma.importJobItem.findFirst({
      where: { importJobId: jobId, status: "queued" },
      orderBy: { order: "asc" },
    });
    if (!next) break;

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

  const remaining = await prisma.importJobItem.count({ where: { importJobId: jobId, status: { not: "done" } } });
  if (remaining === 0) {
    await prisma.importJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "completed" } });
  }
}
```

### Change 2c — new file `app/api/import/start/route.ts`

```ts
import { NextResponse, after } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { processImportJob } from "@/lib/importJob";

export const maxDuration = 60;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

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

  const job = await prisma.importJob.create({
    data: { weekNumber, status: "processing", totalFiles: files.length },
  });

  const items = await Promise.all(
    files.map(async (file, order) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = `${Date.now()}-${order}-${sanitizeFilename(file.name)}`;
      const blob = await put(safeName, buffer, { access: "public", contentType: file.type || "image/png" });
      return {
        importJobId: job.id,
        order,
        filename: file.name,
        blobUrl: blob.url,
        mimeType: file.type || "image/png",
        status: "queued" as const,
      };
    })
  );
  await prisma.importJobItem.createMany({ data: items });

  // Runs after this response has already gone back to the browser - this is what makes
  // the import keep going regardless of what the browser tab does next. If this
  // invocation's own maxDuration runs out mid-batch, /api/import/resume (an external cron
  // plus the Upload page's on-mount nudge) picks up anything still "queued".
  after(() => processImportJob(job.id, Date.now() + 50_000));

  return NextResponse.json({ jobId: job.id, totalFiles: files.length });
}
```

### Change 2d — new file `app/api/import/[jobId]/status/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET(_request: Request, ctx: RouteContext<"/api/import/[jobId]/status">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const jobId = Number((await ctx.params).jobId);
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!job) return NextResponse.json({ error: "Import job not found" }, { status: 404 });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    items: job.items.map((i) => ({
      filename: i.filename,
      status: i.status,
      categoryKey: i.categoryKey,
      confidence: i.confidence,
      resultStatus: i.resultStatus,
      errorMessage: i.errorMessage,
    })),
  });
}
```

### Change 2e — new file `app/api/import/[jobId]/cancel/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(_request: Request, ctx: RouteContext<"/api/import/[jobId]/cancel">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const jobId = Number((await ctx.params).jobId);

  // processImportJob re-checks ImportJob.status on every loop iteration (not just once at
  // the start), so flipping this to "cancelled" actually stops further processing between
  // items - it doesn't just relabel the row.
  await prisma.importJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "cancelled" } });
  await prisma.importJobItem.updateMany({
    where: { importJobId: jobId, status: "queued" },
    data: { status: "done", resultStatus: "error", errorMessage: "Cancelled" },
  });

  return NextResponse.json({ ok: true });
}
```

### Change 2f — new file `app/api/import/resume/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { processImportJob } from "@/lib/importJob";

export const maxDuration = 60;

// Two legitimate callers: (1) an external cron hitting this on a schedule with the shared
// secret below - the actual guarantee that a big import finishes even if nobody ever
// reopens the app; (2) the Upload page firing this once on mount under the admin's own
// session, as a faster nudge for the common "just reopened the app" case. Either way this
// only ever resumes items that are already sitting there "queued".
async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.IMPORT_RESUME_SECRET;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;

  const user = await getCurrentUser();
  return user?.role === "ADMIN";
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const stalled = await prisma.importJob.findMany({
    where: { status: "processing", items: { some: { status: "queued" } } },
    select: { id: true },
  });

  const deadline = Date.now() + 50_000;
  for (const job of stalled) {
    await processImportJob(job.id, deadline);
    if (Date.now() > deadline) break; // the next cron tick picks up whatever's left
  }

  return NextResponse.json({ resumedJobs: stalled.length });
}
```

### Change 2g — delete `app/api/upload/route.ts`

Fully superseded by `/api/import/start` + `/api/import/resume`. Nothing else references
this route (confirmed — only `UploadClient.tsx` calls `/api/upload`, and that's rewritten
below).

### Change 2h — replace `app/upload/UploadClient.tsx` in full

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNavigationBlocker } from "@/components/NavigationBlocker";
import { ProgressBar } from "@/components/ProgressBar";

const LEAVE_WARNING =
  "The import keeps running on the server even if you leave this page, switch to another app, or close your browser entirely - but you won't be able to see live progress or results here once you go. Check Review (or the dashboards) afterwards to see how it went. Leave anyway?";

type ImportItemStatus = "queued" | "processing" | "done";
type ResultStatus = "committed" | "needs_review" | "pending_confirmation" | "error";

type ImportItem = {
  filename: string;
  status: ImportItemStatus;
  categoryKey: string | null;
  confidence: number | null;
  resultStatus: ResultStatus | null;
  errorMessage: string | null;
};

type ImportJobStatus = {
  jobId: number;
  status: "processing" | "completed" | "cancelled";
  totalFiles: number;
  processedFiles: number;
  items: ImportItem[];
};

const STATUS_STYLES: Record<ResultStatus, string> = {
  committed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  pending_confirmation: "bg-blue-100 text-blue-800",
  error: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<ResultStatus, string> = {
  committed: "committed",
  needs_review: "needs review — see Review",
  pending_confirmation: "needs your confirmation — see Review",
  error: "error — see Review",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - a phone screenshot is a few MB at most
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const POLL_INTERVAL_MS = 1500;

export function UploadClient() {
  const [knownWeeks, setKnownWeeks] = useState<number[]>([]);
  const [weekNumber, setWeekNumber] = useState<number>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setBlock } = useNavigationBlocker();

  useEffect(() => {
    fetch("/api/weeks")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load weeks (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: { weeks: number[]; defaultWeek: number }) => {
        setKnownWeeks(data.weeks);
        setWeekNumber(data.defaultWeek);
      })
      .catch((err) => {
        setError(`Could not load known week numbers: ${err instanceof Error ? err.message : String(err)}`);
      });

    // Nudges any import that got interrupted mid-batch back into motion the moment someone
    // reopens this page. The real safety net is the external cron hitting
    // /api/import/resume on a schedule regardless of whether the app is open at all - this
    // is just a faster path for the common case of reopening it yourself.
    fetch("/api/import/resume", { method: "POST" }).catch(() => {});
  }, []);

  // Covers an actual tab close/refresh/typed URL - in-app navigation (NavHeader's Back/Home)
  // goes through useNavigationBlocker instead, since beforeunload doesn't fire for Next.js
  // client-side route changes. The import no longer depends on this tab staying open at
  // all (see LEAVE_WARNING) - this is purely about the live view being lost.
  useEffect(() => {
    if (!submitting) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submitting]);

  // Polls while a job is in flight. Deliberately keeps polling even when the tab is
  // hidden/backgrounded (no visibilitychange gating) - if the browser throttles or fully
  // suspends this timer while backgrounded, that only pauses the LIVE VIEW; the import
  // itself keeps running server-side regardless, and this just picks back up (or shows the
  // final state) whenever the tab becomes active again.
  useEffect(() => {
    if (jobId === null) return;

    async function poll() {
      try {
        const res = await fetch(`/api/import/${jobId}/status`);
        if (!res.ok) return;
        const data: ImportJobStatus = await res.json();
        setJob(data);
        if (data.status !== "processing") {
          setSubmitting(false);
          setBlock(false);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch {
        // Transient network hiccup - next tick tries again.
      }
    }

    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [jobId, setBlock]);

  async function handleCancel() {
    if (jobId === null) return;
    try {
      await fetch(`/api/import/${jobId}/cancel`, { method: "POST" });
    } catch {
      // Best-effort - the resume safety net will just find nothing left queued.
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;

    setSubmitting(true);
    setError(null);
    setJob(null);
    setJobId(null);
    setBlock(true, LEAVE_WARNING);

    try {
      const formData = new FormData();
      formData.set("weekNumber", String(weekNumber));
      for (const file of files) formData.append("files", file);

      const res = await fetch("/api/import/start", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      setJobId(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      setBlock(false);
    }
  }

  const results = job?.items.filter((i) => i.status === "done") ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Import</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="weekNumber" className="text-sm font-medium">
            Week number
          </label>
          <input
            id="weekNumber"
            type="number"
            min={1}
            list="known-weeks"
            value={weekNumber}
            onChange={(e) => setWeekNumber(Number(e.target.value))}
            className="border border-neutral-300 rounded px-3 py-2 w-32"
          />
          <datalist id="known-weeks">
            {knownWeeks.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="files" className="text-sm font-medium">
            Screenshots
          </label>
          <input
            id="files"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              const valid: File[] = [];
              const rejections: string[] = [];

              for (const file of selected) {
                if (file.size > MAX_FILE_SIZE) {
                  rejections.push(`${file.name}: ${Math.round(file.size / 1024 / 1024)}MB exceeds the 10MB limit`);
                } else if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                  rejections.push(`${file.name}: unsupported type "${file.type || "unknown"}" (use JPEG, PNG, or WebP)`);
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
          {files.length > 0 && <p className="text-sm text-neutral-500">{files.length} file(s) selected</p>}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || files.length === 0}
            className="self-start bg-accent text-accent-contrast rounded px-4 py-2 disabled:opacity-50"
          >
            {submitting ? "Processing…" : "Upload & process"}
          </button>
          {submitting && (
            <button
              type="button"
              onClick={handleCancel}
              className="border border-neutral-300 rounded px-4 py-2 hover:bg-neutral-50"
            >
              Cancel
            </button>
          )}
          {job && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-neutral-500">
                {job.status === "processing"
                  ? `Busy with file ${Math.min(job.processedFiles + 1, job.totalFiles)} of ${job.totalFiles}`
                  : job.status === "cancelled"
                    ? `Cancelled after ${job.processedFiles} of ${job.totalFiles} file(s)`
                    : `Done - ${job.processedFiles} of ${job.totalFiles} file(s)`}
              </span>
              <ProgressBar value={job.totalFiles > 0 ? job.processedFiles / job.totalFiles : 0} className="max-w-xs" />
            </div>
          )}
        </div>
      </form>

      {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}

      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Results</h2>

          {results.some((r) => r.resultStatus === "pending_confirmation") && (
            <Link
              href="/review"
              className="bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-2 text-sm hover:bg-blue-100"
            >
              Some imports need your confirmation before they count — go to Review →
            </Link>
          )}

          <ul className="flex flex-col gap-2">
            {results.map((r, i) => (
              <li key={i} className="border border-neutral-200 rounded px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <span className="truncate flex-1">{r.filename}</span>
                <span className="text-neutral-500">{r.categoryKey}</span>
                <span className="text-neutral-500">{r.confidence !== null ? `${Math.round(r.confidence * 100)}%` : ""}</span>
                {r.resultStatus &&
                  (r.resultStatus === "pending_confirmation" || r.resultStatus === "needs_review" || r.resultStatus === "error" ? (
                    <Link
                      href="/review"
                      className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]} hover:underline`}
                    >
                      {STATUS_LABELS[r.resultStatus]}
                    </Link>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]}`}>
                      {STATUS_LABELS[r.resultStatus]}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

Note: `r.filename` is now the original uploaded filename (stored separately from
`blobUrl` in `ImportJobItem`), so the old `.split("/").pop()` hack to trim a full Blob URL
down to something readable is gone — it's just the real filename now.

### Change 2i — `IMPORT_RESUME_SECRET` env var + external cron

Add a line to `.env.example` and `.env.local.example`:

```
IMPORT_RESUME_SECRET=
```

Generate a real random value for `.env.local` and for the Vercel project's environment
variables (Production), e.g.:

```
openssl rand -hex 32
```

Then set up a free external cron (matches the fallback pattern already noted for this
project — Vercel's own Cron Jobs has frequency limits that vary by plan; an external
trigger sidesteps that entirely) at **cron-job.org** (or a scheduled GitHub Actions
workflow, if you'd rather):

- URL: `https://<your-vercel-domain>/api/import/resume`
- Method: `POST`
- Header: `Authorization: Bearer <the secret you generated>`
- Schedule: every 2 minutes

That's the actual guarantee an import finishes even if the app is never reopened after you
start it. The on-mount call from the Upload page (already in the code above) just makes
the common case — reopening the app yourself — resume immediately instead of waiting for
the next cron tick.

### Change 2j — version bump

`lib/version.ts`, change:

```ts
const MINOR = 27;
```

to:

```ts
const MINOR = 28;
```

---

## Deploy checklist

1. Apply Fix 1 (2 file edits) and Fix 2 (schema change, 4 new files, 1 deleted file, 1
   rewritten file, 1 env var + external cron, version bump).
2. `npx prisma db push && npx prisma generate`.
3. Add `IMPORT_RESUME_SECRET` to Vercel's Production env vars (and your local `.env.local`
   if you run this locally) before deploying — the resume route works without it for the
   in-app-admin-session path, but the external cron needs it.
4. Deploy.
5. Set up the cron-job.org job pointed at `/api/import/resume` as described above.
6. Confirm the header now reads the bumped version number.
7. Test Fix 1: find (or create) a member who has never had a Kills reading before, upload
   a Kills screenshot for them for a new week, check `/dashboards/individual/detail` for
   that member — the Kills (gain) column for that week should read **New**, not a blank
   dash and not their full reading.
8. Test Fix 2: start an import with a handful of screenshots, then immediately switch to
   a different app (or lock the phone) for a minute or two, then come back to Review or
   the dashboards (not necessarily the Upload page) — the screenshots should show up
   processed even though the Upload tab was never watched the whole time. Also test the
   explicit "leave anyway?" prompt still appears if you navigate away in-app while an
   import is running.
