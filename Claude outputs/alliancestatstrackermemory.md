# Alliance Stats Tracker — Project Memory

Paste or attach this at the start of a new conversation (or drop it into a
Claude Project's knowledge, see note at the bottom) so Claude doesn't have to
rediscover the basics. It does **not** replace re-reading the actual live
code before making claims about current behavior — treat everything below as
orientation and history, not as a live source of truth for exact current
code.

**Keeping this file current — do this without being asked twice:** whenever
a session learns something that makes a line below wrong (a platform move,
a database swap, a status change from "specced" to "confirmed deployed"),
update this file in that same session and hand Frans a freshly regenerated
copy of the whole file via a downloadable file — don't just mention the
change in chat and leave the file stale. If Frans explicitly asks for "an
updated version of this file" or "a new copy of the memory file," that means
regenerate and deliver the whole file, not a diff or a summary.

## What this is

"alliance-stats-tracker" — a Next.js app Frans built to track stats for his
alliance ("RUNE") in a mobile war game. Members upload screenshots (rankings,
roster, chat), an AI vision pipeline extracts structured stats, and the app
turns that into dashboards, a "Conductor" rotation/points system, season
scoring, and various admin tools.

- Repo: `C:\Users\Frans en Renet\source\repos\alliance-stats-tracker` (Windows, Frans's own machine)
- Stack: Next.js 16 (App Router) + TypeScript, Prisma 7 + Postgres, Tailwind 4, `exceljs` for exports, `@google/genai` (Gemini) for vision extraction
- **Deployed on Vercel** (moved off Render in Sep 2026). `render.yaml` is still in the repo as history/reference but is no longer the deployment source — Vercel builds straight from the repo via its own project settings, no `vercel.json` currently checked in.
- **Database: Neon Postgres** (migrated off Render's own "lastwar" Postgres instance before or around the Vercel move — the old Render database is not what's in use; `DATABASE_URL` must point at Neon's connection string, not a Render one).

## How Claude works on this project — read this first

**Claude (this conversation) never writes directly to the live repo.** The
only access available is the device bridge, read-only:
`mcp__remote-devices__device_list_dir` and `device_stage_files` (which stages
files into `/mnt/user-data/uploads/alliance-stats-tracker/...` for reading).
There is no `device_bash` and no write-back tool.

The actual workflow, every time:
1. Frans describes a bug or a feature.
2. Claude stages and reads the *real, current* source files relevant to it — never guesses from memory of an earlier read, since the live repo keeps changing between conversations.
3. Claude writes a precise Markdown spec (exact file paths, exact line numbers, exact code to add/change, and *why*) and delivers it via `Write` + `SendUserFile`.
4. A **separate Claude Code session running directly on Frans's machine** implements and deploys the change from that spec. Claude here does not do this part.
5. Frans reports back (works / doesn't / new symptom), and Claude re-stages and re-reads the live files to confirm or keep digging.

Keep doing it this way unless Frans explicitly says the setup has changed.

## Core architecture cheat-sheet

- **Auth**: `lib/auth/session.ts` (JWT in an httpOnly cookie via `jose`), `lib/auth/password.ts` (Node `scrypt`, format `salt:hash`, not bcrypt). `Member` *is* the login identity — `Member.id` is the user id everywhere. Roles: `ADMIN | LEADER | MEMBER`, resolved by `lib/auth/roles.ts`'s `effectiveRole()` — a manual `Member.role` override wins; otherwise `allianceRank R4/R5 → LEADER`, else `MEMBER`. `lib/auth/dal.ts` has the guard helpers: `requireRole`/`requireAdmin` (Server Components, redirect), `requireAdminApi`/`requireAuthApi` (Route Handlers, JSON 401/403).
- **Menu system**: `prisma/seed.ts`'s `MENU_ITEMS` array is the fail-closed source of truth for every nav entry (`key, label, href, roles, parentKey`). Re-synced on every deploy — only the `roles` field is preserved across reseeds (admin-editable via the Menu Access page); everything else is code-owned. A page with no `MenuItem` row is invisible in nav even if it exists and is reachable by direct URL.
- **Categories**: `Category` model — `key`, `name`, `shape` (`ranking_list` | `roster` | `free_text`), `divisor`, `cumulative` (lifetime-running-total categories get week-over-week diffed, not read raw), and `conductorMode` (`off | rate | flat`) + `conductorPointsPerUnit`/`conductorUnitSize`/`conductorFlatValue` for the points engine. Seeded list is in `prisma/seed.ts`'s `CATEGORIES` array — **this upsert overwrites `name`/`description`/etc. on every deploy**, so an admin can't durably rename a category from the UI; it has to change at the seed source.
- **AI extraction pipeline**: `lib/ai/{prompts,extract,classify}.ts` (Gemini vision) → `lib/pipeline/run.ts` (`runPipelineForImage`) → `lib/pipeline/matchMember.ts` (fuzzy-matches the extracted name against the roster, Unicode-safe normalize + Levenshtein within ~20% of name length, auto-creates a new `Member` with `nameConfirmed: false` if nothing matches closely enough).
- **Conductor points engine**: `lib/conductor/points.ts` — `pointsForCategoryWeek()` scores one member/category/week (`rate` = `(value/unitSize)*pointsPerUnit`, `flat` = fixed value if present that week). `computeStandings()` = `accumulated` (sum of earned points from `Setup → Conductor`'s `fromWeek` onward) minus `lessSelected` (sum of `ConductorSelection.pointsAtSelection`, frozen at each confirmed round). `recalculateSelectionPoints()` rebuilds those frozen values from real stats, chained per member in round-start order.
- **The recurring bug to always check**: whenever a new table gets a relation to `Member`, `app/api/users/merge/route.ts`'s move-or-drop logic needs a matching line, or merging two accounts crashes with a Postgres FK RESTRICT error. This has bitten this app multiple times already (`SeasonExtraValue`/`SeasonResult` were missed originally; `PivotView`/`FeedbackItem` needed it added when built). Current full list of Member-relation tables: `WeeklyStat, CategoryRecord, ConductorSelection, Suggestion, SeasonExtraValue, SeasonResult, PivotView, FeedbackItem` (+ `VisitLog` if that spec shipped). One later spec (the "Reject new user" fix) built a generic, schema-driven delete helper using `Prisma.dmmf` specifically to stop having to hand-maintain this list for *deletes* — worth reusing that technique again rather than another manual list.
- **UI conventions already established** — mirror these rather than inventing new patterns: role-scoped member picker (`MEMBER` only ever sees themselves, `ADMIN`/`LEADER` get a `<select>` to pick anyone — seen in `dashboards/individual/detail`, `dashboards/alliance/graphs`), GET-form-with-searchParams for report filters (bookmarkable, no client state needed), a `busy`/`saving` boolean + text-swap on every button that waits on a request (`ShareReportButton.tsx` is the reference), `ExcelExportButton` for exports, `ProgressBar` for longer operations, `DataTable`/`MobileCardList` for tabular reports.
- **Platform gotcha (new, Sep 2026): Vercel's serverless functions have a read-only filesystem outside `/tmp`.** Anything that used to write to local disk on Render (e.g. the original `/api/upload` route saving screenshots under `public/uploads`) will crash on Vercel — the request throws before a response is sent, which the browser sees as an empty/unparseable JSON response. Any feature that needs to persist an uploaded file for later display must use Vercel Blob (`@vercel/blob`'s `put()`, returns a public URL) instead of the filesystem. This bit the main Import screen once already (see below) — check for the same pattern before shipping any other upload/import feature.

## What's shipped, what's specced-but-unconfirmed

Confirmed live and working (Frans has used them / re-verified them):
- Alliance tag as a case-insensitive `Setting` (fixed the original "0 points" Capture bug)
- Merge route handling `SeasonExtraValue`/`SeasonResult`
- Backup & Restore under Setup (`settings-backup` menu item)
- Custom Pivot & Saved Views (`/dashboards/pivot`)
- Bug Report & Feature Request (`/feedback`) — admin-only edit/delete/status, not just ADMIN-or-LEADER
- Conductor Points Statement (`/dashboards/individual/statement`) — the ledger/audit view

Specced and delivered, **not yet confirmed deployed** as of the last check-in:
- HQ category mis-named "Members" → rename fix in `prisma/seed.ts`
- Arabic (and any non-Latin-script) member names getting mis-transcribed by the AI extraction prompt, causing duplicate "ghost" members instead of matching the real one
- Visit Tracker: owner-only (`OWNER_MEMBER_ID` env var, not just ADMIN role, since other admins exist) login log, delivered as a periodic email digest via Resend rather than an in-app page
- Forgot Password flow: self-invalidating signed tokens (no new table), emails a reset link to `Member.contactEmail`
- "Reject" button for unconfirmed/"New" auto-created members (full cascade delete via the DMMF-driven helper mentioned above)
- Recalculate-selection-points performance fix (was doing hundreds of sequential row updates in a `$transaction` array — replaced with one bulk `UPDATE ... FROM (VALUES ...)` statement)
- Conductor Statement follow-ups: Detail/Summary view toggle, pivoted single-sheet export (one row per week, one column per category), and **rank per week** (not just current rank) — computed efficiently via one cumulative-balance array per member, not a per-week recomputation
- **Vercel import fix**: `/api/upload` no longer writes screenshots to local disk (broke on Vercel — see platform gotcha above); switched to Vercel Blob (`put()`), with `app/raw/page.tsx`'s thumbnail check updated to match a URL instead of the old `/uploads/` path. Requires the Blob store to be connected on the Vercel project (adds `BLOB_READ_WRITE_TOKEN` automatically) and `npm install @vercel/blob`.

Discussed but deliberately not built:
- Multi-alliance support (physical DB-per-alliance recommended if it's ever actually needed; explicitly deferred)
- A donate option under the Users screen (cost/effort discussed conversationally, no spec)
- A wishlist of future ideas — Weekly Wrap (AI-narrated, with a 5-week rolling trend), Badges & Streaks, "Your Journey" narrated, a public live leaderboard link, an At-Risk-Member signal — captured in a published artifact: **"RUNE Feature Dossier"**, `https://claude.ai/code/artifact/06a97832-8923-4a7e-9809-61fa4fa0c33c`. Worth checking whether it needs updating if new ideas come up.

## Known operational gotchas

- The Conductor "From week" setting and the "Recalculate selection points" button live in *different sections* of the same Setup → Conductor page, each with its own Save/action button — it's easy to change "From week" and click Recalculate without actually saving the setting first, which looks like nothing happened.
- Changing "From week" **without** recalculating afterward will produce negative standings totals for anyone already selected as Conductor, because their frozen reset amount was computed under the old baseline. Always recalculate right after changing it.
- Password reset: there was no self-service recovery until the Forgot Password spec — until that's deployed, a locked-out admin's only path back in is direct SQL against the Neon Postgres dashboard (format: `scrypt` `salt:hash`, computed locally with Node's built-in `crypto`).
- Any local-disk write in an API route is a Vercel landmine (see platform gotcha above) — this already broke the main screenshot import once; check new upload/export/report-generation features for the same assumption before they ship.
- Scheduling: the old Render-specific note here (Render's Cron Job service type needing a paid plan) no longer applies now that the app is on Vercel — Vercel has its own Cron Jobs feature with its own limits (frequency/invocation caps differ by plan). Re-check Vercel's current Cron Jobs limits before relying on one if a scheduled task is ever needed; a free external trigger (cron-job.org, or a scheduled GitHub Actions workflow) hitting a secret-protected route is still the fallback if Vercel's own limits don't fit.

## Style notes for whoever picks this up

Frans wants specs grounded in the *actual current code* — exact file paths, exact line numbers, exact snippets to add — not generic scaffolding. He pushes back (rightly) when a diagnosis turns out to be guesswork instead of based on a real error log or a real file read. He's fine with being told "I found a related gap but didn't fix it, tell me if you want it too" rather than scope creeping into things he didn't ask for. Ask a real clarifying question when a decision is genuinely his to make (permissions, scope, UX trade-offs) — but don't ask when the answer is obvious from the existing codebase's own conventions.

---

## Starting new conversations for this project

Settled approach: attach this file at the start of each new chat. No Project
or device-bridge linking needed for that — attaching the file gives a fresh
conversation the orientation (workflow, architecture, status, gotchas)
without re-explaining it, and keeps that chat's context smaller than if it
had to inherit this whole conversation's history.

One thing this file can't do: it's a static snapshot, not a live view of the
code. It captures conventions, history, and decisions as of whenever it was
last updated — it does not know what today's actual files look like. So for
anything beyond a quick question, a fresh conversation still needs to stage
and read the real current source through the device bridge before proposing
a fix, exactly as every conversation on this project has done so far. This
file just makes getting to that point faster.

This file is refreshed proactively (see the instruction at the top) whenever
a session's work makes a line here stale — not just when Frans happens to
ask. If it ever does drift (a status list not matching what's actually
deployed, an infra detail that changed without this file catching up), that
is a bug in the process worth flagging back, not something to silently work
around.
