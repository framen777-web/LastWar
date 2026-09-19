# Two features: actionable review screen, and login by alias/email/phone

For the Claude Code session on Frans's machine. Two independent pieces —
implement in either order. Part A assumes the Vercel Blob fix (separate
spec, `vercel-import-fix-spec.md`) has already shipped, since it depends on
`RawExtraction.imageFilename` being a real fetchable URL going forward.

---

# Part A: make "needs review" actionable, with the image and a fix-it screen

## What's broken today

`app/upload/UploadClient.tsx` renders a plain, non-clickable `<span>` for
both the `needs_review` and `error` result statuses (lines 262-273) — there
is genuinely nothing to click, because nothing downstream of it does
anything with those rows. Meanwhile `/review` (`app/review/ReviewClient.tsx`)
only ever fetches `status=pending_confirmation` (line 32) — it doesn't show
`needs_review` rows at all.

Both failure paths in `runPipelineForImage()` (classification failed,
category unknown/low-confidence, category missing/inactive, or extraction
threw) all land in the same place: a `RawExtraction` row with DB
`status: "needs_review"` and `rawJson: "{}"` (see `createNeedsReview()` in
`lib/pipeline/run.ts`, lines 90-94) — there's no extracted data to show
because extraction never got that far. So "reviewing" one of these means:
look at the original screenshot, tell the app what category it actually is,
and let it re-run extraction against that image — not editing already-
extracted fields like the existing pending_confirmation review flow does.

I can't crop to "just the relevant section" of the image — the extraction
schema doesn't return bounding boxes/coordinates today, only the parsed
fields, so there's no region to crop to. Showing the full image at a decent
size (not the 80×80 thumbnail `/raw` uses) is the honest version of "let me
verify before I submit" that's achievable without a bigger change to the
extraction schema. If you want real crop-to-region later, that means asking
Gemini to also return a bounding box per row — a separate, bigger spec.

## 1. `lib/pipeline/run.ts` — add a reprocess function

Add this new exported function (goes anywhere alongside
`confirmRawExtraction`/`rejectRawExtraction`, which it mirrors):

```ts
// Re-runs extraction for a needs_review row against a manually-chosen category, using the
// originally-uploaded image (fetched back from its stored Blob URL - see reprocessNeedsReview's
// image-availability check below for rows that predate the Vercel Blob switch). This is the
// "verify and submit" action behind the Review screen's fix-it UI for needs_review items -
// unlike confirmRawExtraction, there's no existing rawJson to reuse (needs_review rows are
// created with rawJson: "{}", precisely because classification/extraction never got that far).
export async function reprocessNeedsReview(id: number, categoryKey: string): Promise<PipelineResult> {
  const row = await prisma.rawExtraction.findUniqueOrThrow({ where: { id } });
  if (row.status !== "needs_review") {
    throw new Error(`RawExtraction ${id} is not needs_review (status: ${row.status})`);
  }

  if (!/^https?:\/\//.test(row.imageFilename)) {
    throw new Error(
      "The original screenshot isn't available to re-process (this row predates the Vercel Blob " +
        "switch, or the image was otherwise never stored as a URL) - reject this and re-upload the screenshot instead."
    );
  }

  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !category.active) {
    throw new Error(`Unknown or inactive category "${categoryKey}"`);
  }

  const imageResponse = await fetch(row.imageFilename);
  if (!imageResponse.ok) {
    throw new Error(`Couldn't re-fetch the stored image (HTTP ${imageResponse.status}).`);
  }
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const imageBase64 = buffer.toString("base64");
  const mimeType = imageResponse.headers.get("content-type") || "image/png";

  const extracted = await extract(category, imageBase64, mimeType);

  if (category.shape === "free_text") {
    await prisma.rawExtraction.update({
      where: { id },
      data: { categoryKey, rawJson: JSON.stringify(extracted), status: "pending_confirmation" },
    });
    return { filename: row.imageFilename, categoryKey, confidence: 1, status: "pending_confirmation" };
  }

  await prisma.rawExtraction.update({
    where: { id },
    data: { categoryKey, rawJson: JSON.stringify(extracted), status: "committed" },
  });
  await writeExtraction(category, extracted, row.weekNumber);

  return { filename: row.imageFilename, categoryKey, confidence: 1, status: "committed" };
}
```

Also broaden `rejectRawExtraction` (currently only accepts
`pending_confirmation`) so it works from the new screen too:

```ts
// Was: if (row.status !== "pending_confirmation") { ... }
export async function rejectRawExtraction(id: number): Promise<void> {
  const row = await prisma.rawExtraction.findUniqueOrThrow({ where: { id } });
  if (row.status !== "pending_confirmation" && row.status !== "needs_review") {
    throw new Error(`RawExtraction ${id} is not pending confirmation or needs review (status: ${row.status})`);
  }
  await prisma.rawExtraction.update({ where: { id }, data: { status: "rejected" } });
}
```

No new imports needed — `extract`, `prisma`, and `writeExtraction` are
already in scope in this file.

## 2. `app/api/raw/route.ts` — allow fetching more than one status

```ts
// Was: const status = searchParams.get("status");
const statusParam = searchParams.get("status");
const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

const extractions = await prisma.rawExtraction.findMany({
  where: statuses ? { status: { in: statuses } } : undefined,
  orderBy: { createdAt: "desc" },
  take: 100,
});
```

(Comma-separated, backward compatible with a single status.)

## 3. `app/api/raw/[id]/route.ts` — add the `reprocess` action

```ts
import { NextResponse } from "next/server";
import { confirmRawExtraction, rejectRawExtraction, reprocessNeedsReview } from "@/lib/pipeline/run";
import { requireAdminApi } from "@/lib/auth/dal";

export async function PATCH(request: Request, ctx: RouteContext<"/api/raw/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const rawExtractionId = Number(id);

  const body = (await request.json()) as { action?: "confirm" | "reject" | "reprocess"; categoryKey?: string };

  try {
    if (body.action === "confirm") {
      await confirmRawExtraction(rawExtractionId);
    } else if (body.action === "reject") {
      await rejectRawExtraction(rawExtractionId);
    } else if (body.action === "reprocess") {
      if (!body.categoryKey) {
        return NextResponse.json({ error: "categoryKey is required to reprocess." }, { status: 400 });
      }
      await reprocessNeedsReview(rawExtractionId, body.categoryKey);
    } else {
      return NextResponse.json({ error: "action must be 'confirm', 'reject', or 'reprocess'" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
```

## 4. `app/upload/UploadClient.tsx` — make the labels actual links

Line 19-24, update the labels so it's visually obvious they're now clickable:

```ts
const STATUS_LABELS: Record<PipelineResult["status"], string> = {
  committed: "committed",
  needs_review: "needs review — see Review",
  pending_confirmation: "needs your confirmation — see Review",
  error: "error — see Review",
};
```

Lines 262-273, broaden the condition that decides Link-vs-span:

```tsx
{r.status === "pending_confirmation" || r.status === "needs_review" || r.status === "error" ? (
  <Link
    href="/review"
    className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.status]} hover:underline`}
  >
    {STATUS_LABELS[r.status]}
  </Link>
) : (
  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.status]}`}>
    {STATUS_LABELS[r.status]}
  </span>
)}
```

## 5. `app/review/ReviewClient.tsx` — show and act on needs_review items

This needs three additions: fetch both statuses, fetch the active category
list for the picker, and render a distinct card for `needs_review` items
(image + category picker + Reprocess/Reject) alongside the existing
pending_confirmation cards. Full replacement:

```tsx
"use client";

import { useEffect, useState } from "react";

type ParsedMember = {
  member_name: string;
  air?: number;
  tank?: number;
  missile?: number;
  fourth?: number;
  needsReview?: boolean;
};

type PendingExtraction = {
  id: number;
  imageFilename: string;
  categoryKey: string;
  weekNumber: number;
  confidence: number;
  status: "pending_confirmation" | "needs_review";
  createdAt: string;
  parsed: { members?: ParsedMember[] } | null;
};

type CategoryOption = { key: string; name: string; active: boolean };

export function ReviewClient() {
  const [items, setItems] = useState<PendingExtraction[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [rawRes, categoriesRes] = await Promise.all([
      fetch("/api/raw?status=pending_confirmation,needs_review"),
      fetch("/api/categories"),
    ]);
    const rawData = await rawRes.json();
    const categoriesData = await categoriesRes.json().catch(() => ({ categories: [] }));
    setItems(rawData.extractions ?? []);
    setCategories((categoriesData.categories ?? []).filter((c: CategoryOption) => c.active));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Confirming/rejecting/reprocessing writes Member rows (matchMember() can create new ones) -
  // running two of these at once from this screen is exactly what let concurrent confirms race
  // each other into creating the same brand-new member twice. `busyId` doubles as a global
  // lock (all buttons disabled while it's set, not just the clicked item's) so actions here
  // are always strictly one-at-a-time.
  async function act(id: number, body: { action: "confirm" | "reject" | "reprocess"; categoryKey?: string }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/raw/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn't ${body.action} that item - try again.`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const pendingConfirmation = items.filter((i) => i.status === "pending_confirmation");
  const needsReview = items.filter((i) => i.status === "needs_review");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Review</h1>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        {loading && <p className="text-neutral-500 text-sm mt-2">Loading…</p>}
      </div>

      {!loading && needsReview.length > 0 && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-medium">Needs review</h2>
            <p className="text-neutral-500 text-sm">
              These screenshots couldn&apos;t be classified or read automatically. Look at the image, pick the
              right category, and reprocess - or reject if it&apos;s not a usable screenshot at all.
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {needsReview.map((item) => {
              const hasImage = /^https?:\/\//.test(item.imageFilename);
              const draft = categoryDrafts[item.id] ?? (categories.some((c) => c.key === item.categoryKey) ? item.categoryKey : "");
              return (
                <li key={item.id} className="border border-neutral-200 rounded p-4 flex flex-col gap-3 sm:flex-row">
                  {hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageFilename}
                      alt="Screenshot needing review"
                      className="w-full sm:w-64 max-h-96 object-contain rounded border border-neutral-200 bg-neutral-50"
                    />
                  ) : (
                    <div className="w-full sm:w-64 h-32 flex items-center justify-center text-xs text-neutral-400 border border-dashed border-neutral-300 rounded">
                      Original image no longer available
                    </div>
                  )}

                  <div className="flex-1 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-neutral-500">week {item.weekNumber}</span>
                      <span className="text-neutral-500">
                        guessed: {item.categoryKey} ({Math.round(item.confidence * 100)}%)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={draft}
                        onChange={(e) => setCategoryDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                        disabled={busyId !== null}
                        className="border border-neutral-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">Pick the actual category…</option>
                        {categories.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => act(item.id, { action: "reprocess", categoryKey: draft })}
                        disabled={busyId !== null || !draft || !hasImage}
                        className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {busyId === item.id ? "Reprocessing…" : "Reprocess"}
                      </button>
                      <button
                        onClick={() => act(item.id, { action: "reject" })}
                        disabled={busyId !== null}
                        className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {busyId === item.id ? "Rejecting…" : "Reject"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!loading && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-medium">Needs your confirmation</h2>
            <p className="text-neutral-500 text-sm">
              Free-text imports (like Squads) are never written automatically — confirm each one below before it
              counts, or reject it if the reading looks wrong.
            </p>
          </div>

          {pendingConfirmation.length === 0 ? (
            <p className="text-neutral-500 text-sm">Nothing waiting for confirmation.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {pendingConfirmation.map((item) => (
                <li key={item.id} className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-medium">{item.categoryKey}</span>
                    <span className="text-neutral-500">week {item.weekNumber}</span>
                    <span className="text-neutral-500">{Math.round(item.confidence * 100)}% confidence</span>
                  </div>

                  {item.parsed?.members && item.parsed.members.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-neutral-200 text-left">
                            <th className="py-1 pr-4">Member</th>
                            <th className="py-1 pr-4">Air</th>
                            <th className="py-1 pr-4">Tank</th>
                            <th className="py-1 pr-4">Missile</th>
                            <th className="py-1 pr-4">Fourth</th>
                            <th className="py-1 pr-4"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.parsed.members.map((m, i) => (
                            <tr key={i} className={`border-b border-neutral-100 ${m.needsReview ? "bg-amber-50" : ""}`}>
                              <td className="py-1 pr-4 font-medium whitespace-nowrap">{m.member_name}</td>
                              <td className="py-1 pr-4">{m.air ?? "—"}</td>
                              <td className="py-1 pr-4">{m.tank ?? "—"}</td>
                              <td className="py-1 pr-4">{m.missile ?? "—"}</td>
                              <td className="py-1 pr-4">{m.fourth ?? "—"}</td>
                              <td className="py-1 pr-4">
                                {m.needsReview && (
                                  <span className="bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5 text-xs whitespace-nowrap">
                                    Recheck — fewer than 3 values read
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-neutral-400 text-xs">No members parsed from this image.</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => act(item.id, { action: "confirm" })}
                      disabled={busyId !== null}
                      className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {busyId === item.id ? "Confirming…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => act(item.id, { action: "reject" })}
                      disabled={busyId !== null}
                      className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {busyId === item.id ? "Rejecting…" : "Reject"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

Note the `CategoryOption` returned by `GET /api/categories` includes more
fields than shown here (`recordCount`, `usedInSeasons`, etc. per
`app/api/categories/route.ts`) — the type above only declares what this
component reads, which is fine structurally, but double check the actual
field is named `active` (it reads that way from `serialize(c)` in that
route — verify against `lib/categories/validate.ts` if the build complains).

### Test plan (Part A)

1. Force a needs_review row (easiest: temporarily deactivate a category, or
   upload something ambiguous) and confirm it now shows up on `/review`
   under "Needs review" with the actual screenshot visible.
2. Pick the correct category and click Reprocess — confirm it either
   commits or moves to the confirmation section, and disappears from
   "Needs review".
3. Click Reject on a needs_review item, confirm it disappears and the
   RawExtraction row's status becomes `rejected`.
4. From the Import screen, upload something that will fail, and click the
   resulting "needs review — see Review" / "error — see Review" label -
   confirm it navigates to `/review`.

---

# Part B: login by alias, email, or phone (not just the screen name)

## The problem

`app/login/actions.ts` looks members up by `Member.name` — the exact
in-game screen name, in whatever script/characters the AI extracted it in.
That's the only login identifier today. For a member whose screen name is
in Arabic, Cyrillic, contains emoji, etc., that's genuinely hard to type
into a phone keyboard every time. `Member.name` must stay untouched, since
it's what every report/dashboard displays — this only adds *alternative*
ways to log in, alongside it.

## 1. `prisma/schema.prisma` — new field + uniqueness

Add to the `Member` model (near the other login-access fields, after
`theme`):

```prisma
  // Optional plain-text login identifier, set by the member (Account page) or an admin
  // (Setup -> Users) - for logging in without typing the actual screen name (name stays
  // whatever the AI extracted, in whatever script, and is what reports always show).
  loginAlias String? @unique
```

And add `@unique` to the two existing contact fields, so they can double as
login identifiers without ambiguity:

```prisma
  contactWhatsapp String? @unique
  contactEmail    String? @unique
```

**Before running the migration**, check for existing duplicates - Postgres
unique indexes allow any number of `NULL`s but will reject the migration if
two members already share a real value:

```sql
select "contactEmail", count(*) from "Member" where "contactEmail" is not null group by 1 having count(*) > 1;
select "contactWhatsapp", count(*) from "Member" where "contactWhatsapp" is not null group by 1 having count(*) > 1;
```

If either returns rows, resolve those duplicates manually before migrating
(both fields already store `null` rather than `""` when empty - see
`app/api/account/contact/route.ts` line 19 - so blank values won't
conflict). Then `npx prisma migrate dev --name add_login_alias_and_unique_contact`
locally, and deploy the migration to Neon the same way prior migrations
have been (via whatever the current Vercel/Neon migration step is).

## 2. `app/login/actions.ts` — check all four identifiers

```ts
"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/auth/roles";
import { getGeneralPassword } from "@/lib/settings";
import type { Member } from "@/lib/generated/prisma/client";

async function checkPassword(member: Member, password: string): Promise<boolean> {
  if (member.passwordHash) return verifyPassword(password, member.passwordHash);
  if (effectiveRole(member) === "ADMIN") return false;
  const generalPassword = await getGeneralPassword();
  return !!generalPassword && password === generalPassword;
}

export async function login(formData: FormData) {
  const identifier = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const member = identifier
    ? await prisma.member.findFirst({
        where: {
          OR: [
            { name: { equals: identifier, mode: "insensitive" } },
            { loginAlias: { equals: identifier, mode: "insensitive" } },
            { contactEmail: { equals: identifier, mode: "insensitive" } },
            { contactWhatsapp: identifier },
          ],
        },
      })
    : null;

  const valid = !!member && member.isActive && (await checkPassword(member, password));
  if (!valid || !member) {
    redirect("/login?error=1");
  }

  await createSession(member.id);
  redirect("/");
}
```

This also replaces the old two-step lookup (`findUnique` then a manual
`findMany()` + `.toLowerCase()` scan of every member for the case-
insensitive fallback) with one query using Postgres's native
case-insensitive match — a small efficiency improvement that falls out of
this change for free.

## 3. `app/login/page.tsx` — relabel the field

Line 13-15, so people know the field takes more than the screen name:

```tsx
<label htmlFor="name" className="text-sm font-medium">
  Commander name, alias, email, or phone
</label>
```

## 4. Self-service alias — new route + Account page section

New file `app/api/account/alias/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";

// Deliberately plain ASCII, not \p{L} - the whole point of a login alias is to be
// something easy to type, unlike a screen name that might be in a non-Latin script.
const ALIAS_PATTERN = /^[A-Za-z0-9 _.-]{2,32}$/;

export async function PATCH(request: Request) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { loginAlias?: string };
  const loginAlias = typeof body.loginAlias === "string" ? body.loginAlias.trim() : "";

  if (loginAlias && !ALIAS_PATTERN.test(loginAlias)) {
    return NextResponse.json(
      { error: "Alias must be 2-32 plain characters: letters, numbers, spaces, underscores, dots, or hyphens." },
      { status: 400 }
    );
  }

  try {
    await prisma.member.update({
      where: { id: gate.user.id },
      data: { loginAlias: loginAlias || null },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "That alias is already taken." }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ loginAlias });
}
```

`app/account/page.tsx` — pass the current alias through:

```tsx
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/dal";
import { AccountClient } from "./AccountClient";

export default async function AccountPage() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);
  const contact = await prisma.member.findUnique({
    where: { id: user.id },
    select: { contactWhatsapp: true, contactEmail: true, loginAlias: true },
  });

  return (
    <AccountClient
      name={user.name}
      role={user.role}
      initialTheme={user.theme}
      initialWhatsapp={contact?.contactWhatsapp ?? ""}
      initialEmail={contact?.contactEmail ?? ""}
      initialLoginAlias={contact?.loginAlias ?? ""}
    />
  );
}
```

`app/account/AccountClient.tsx` — add a `initialLoginAlias` prop and a new
section, placed before "Contact info" (so it reads as "how you sign in"
first, contact info second):

```tsx
export function AccountClient({
  name,
  role,
  initialTheme,
  initialWhatsapp,
  initialEmail,
  initialLoginAlias,
}: {
  name: string;
  role: "ADMIN" | "LEADER" | "MEMBER";
  initialTheme: string;
  initialWhatsapp: string;
  initialEmail: string;
  initialLoginAlias: string;
}) {
```

Add alongside the other `useState` declarations near the top:

```ts
const [loginAlias, setLoginAlias] = useState(initialLoginAlias);
const [aliasError, setAliasError] = useState<string | null>(null);
const [aliasSaved, setAliasSaved] = useState(false);
const [savingAlias, setSavingAlias] = useState(false);

async function handleAliasSubmit(e: React.FormEvent) {
  e.preventDefault();
  setAliasError(null);
  setAliasSaved(false);
  setSavingAlias(true);

  const res = await fetch("/api/account/alias", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginAlias }),
  });
  const data = await res.json();
  setSavingAlias(false);

  if (!res.ok) {
    setAliasError(data.error ?? "Something went wrong.");
    return;
  }
  setAliasSaved(true);
}
```

New section in the JSX, right after the `<h1>`/subtitle block and before
"Contact info":

```tsx
<section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
  <h2 className="font-semibold">Login alias</h2>
  <p className="text-neutral-500 text-sm">
    Your reports always show your screen name ({name}). If it&apos;s awkward to type when logging in,
    set a plain-text alias here, or use your email/phone below instead - any of them work at the login screen.
  </p>

  <form onSubmit={handleAliasSubmit} className="flex flex-col gap-3 max-w-sm">
    <input
      type="text"
      value={loginAlias}
      onChange={(e) => {
        setLoginAlias(e.target.value);
        setAliasSaved(false);
      }}
      placeholder="e.g. frans"
      className="border border-neutral-300 rounded px-3 py-2"
    />
    {aliasError && <p className="text-red-600 text-sm">{aliasError}</p>}
    {aliasSaved && <p className="text-green-700 text-sm">Saved.</p>}
    <button
      type="submit"
      disabled={savingAlias}
      className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
    >
      {savingAlias ? "Saving…" : "Save"}
    </button>
  </form>
</section>
```

And update the existing "Contact info" section's description, since those
fields are no longer *only* for admin contact:

```tsx
<p className="text-neutral-500 text-sm">
  Optional. Also usable to log in (see above), and if you ever get locked out, this is how an
  admin can reach you to arrange a password reset.
</p>
```

## 5. Admin-side alias editing — Setup → Users

`app/api/users/route.ts` GET — include the alias in the list response:

```ts
users: members.map((m) => ({
  id: m.id,
  name: m.name,
  allianceRank: m.allianceRank,
  roleOverride: m.role,
  effectiveRole: effectiveRole(m),
  hasPassword: !!m.passwordHash,
  isActive: m.isActive,
  nameConfirmed: m.nameConfirmed,
  loginAlias: m.loginAlias,
})),
```

`app/api/users/[id]/route.ts` PATCH — accept and validate `loginAlias`
(reuse the same pattern as `/api/account/alias/route.ts`, including the
`P2002` → "That alias is already taken." handling):

```ts
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { getMinPasswordLength } from "@/lib/settings";
import { deleteMemberAndAllData } from "@/lib/pipeline/deleteMember";

const ALIAS_PATTERN = /^[A-Za-z0-9 _.-]{2,32}$/;

export async function PATCH(request: Request, ctx: RouteContext<"/api/users/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const memberId = Number(id);

  const current = await prisma.member.findUnique({ where: { id: memberId } });
  if (!current) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    password?: string;
    role?: string | null;
    isActive?: boolean;
    nameConfirmed?: boolean;
    loginAlias?: string | null;
  };
  const data: {
    passwordHash?: string;
    role?: string | null;
    isActive?: boolean;
    nameConfirmed?: boolean;
    loginAlias?: string | null;
  } = {};

  if (typeof body.password === "string" && body.password.length > 0) {
    const minPasswordLength = await getMinPasswordLength();
    if (body.password.length < minPasswordLength) {
      return NextResponse.json({ error: `Password must be at least ${minPasswordLength} characters.` }, { status: 400 });
    }
    data.passwordHash = hashPassword(body.password);
  }

  if (body.role !== undefined) {
    if (body.role !== null && body.role !== "ADMIN" && body.role !== "LEADER" && body.role !== "MEMBER") {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    data.role = body.role;
  }

  if (body.isActive !== undefined) {
    data.isActive = body.isActive;
  }

  if (typeof body.nameConfirmed === "boolean") data.nameConfirmed = body.nameConfirmed;

  if (body.loginAlias !== undefined) {
    const alias = (body.loginAlias ?? "").trim();
    if (alias && !ALIAS_PATTERN.test(alias)) {
      return NextResponse.json(
        { error: "Alias must be 2-32 plain characters: letters, numbers, spaces, underscores, dots, or hyphens." },
        { status: 400 }
      );
    }
    data.loginAlias = alias || null;
  }

  // Guardrail: never leave zero active admins (mirrors spec §11 "Last admin").
  const losingAdmin =
    current.role === "ADMIN" &&
    current.isActive &&
    ((body.role !== undefined && body.role !== "ADMIN") || body.isActive === false);

  if (losingAdmin) {
    const otherActiveAdmins = await prisma.member.count({
      where: { role: "ADMIN", isActive: true, id: { not: memberId } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: "Can't remove the last active admin." }, { status: 400 });
    }
  }

  try {
    const updated = await prisma.member.update({ where: { id: memberId }, data });
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "That alias is already taken." }, { status: 400 });
    }
    throw err;
  }
}
```

`app/setup/users/list/UsersClient.tsx` — add `loginAlias` to the `User`
type, an `aliasDrafts` state map (same shape as the existing
`passwordDrafts`), and a new column. Add to the type and state:

```ts
type User = {
  id: number;
  name: string;
  allianceRank: string | null;
  roleOverride: Role | null;
  effectiveRole: Role;
  hasPassword: boolean;
  isActive: boolean;
  nameConfirmed: boolean;
  loginAlias: string | null;
};
```

```ts
const [aliasDrafts, setAliasDrafts] = useState<Record<number, string>>({});
```

Add a new `<th>Alias</th>` after the `Login` header, and a matching `<td>`
in the row (same input+button convention as the password cell right next
to it):

```tsx
<td className="py-2 pr-3">
  <div className="flex items-center gap-2">
    <input
      type="text"
      placeholder={u.loginAlias ?? "No alias"}
      value={aliasDrafts[u.id] ?? u.loginAlias ?? ""}
      onChange={(e) => setAliasDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
      className="border border-neutral-300 rounded px-2 py-1 w-28 text-xs"
    />
    <button
      onClick={async () => {
        await patchUser(u.id, { loginAlias: aliasDrafts[u.id] ?? "" });
      }}
      disabled={busyId === u.id || aliasDrafts[u.id] === undefined}
      className="border border-neutral-300 rounded px-2 py-1 text-xs disabled:opacity-50"
    >
      Set
    </button>
  </div>
</td>
```

## What this does not touch

Nothing here changes `Member.name` or any report/dashboard query - they
already read `name` directly and this feature never writes to it, so
"screen name always shown on reports" holds by construction, not by
special-casing anything. The forgot-password flow already emails
`contactEmail`; that's unaffected. Merge/delete of a member with a
`loginAlias` set isn't specifically handled here - if you merge two members
and only the *losing* one had an alias set, that alias is simply lost
(same as any other field on the deleted row). Worth a follow-up only if
that turns out to matter in practice.

## Bump the version number

`lib/version.ts` — increment `MINOR` by 1 from whatever it currently is at
implementation time.

## Test plan (Part B)

1. Run the migration; confirm no duplicate-value failures.
2. Set a login alias for yourself via Account, then log out and log back in
   using the alias instead of your screen name.
3. Set a contact email via Account, log in with that email.
4. As admin, set someone else's alias from Setup → Users; confirm the
   "That alias is already taken" error shows if you reuse one already in use.
5. Confirm a report/dashboard for that member still shows their real screen
   name, not the alias.
