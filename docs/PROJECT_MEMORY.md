# Alliance Stats Tracker — Project Memory

Paste or attach this at the start of a new conversation (or drop it into a
Claude Project's knowledge, see note at the bottom) so Claude doesn't have to
rediscover the basics. It does **not** replace re-reading the actual live
code before making claims about current behavior — treat everything below as
orientation and history, not as a live source of truth for exact current
code.

## What this is

"alliance-stats-tracker" — a Next.js app Frans built to track stats for his
alliance ("RUNE") in a mobile war game. Members upload screenshots (rankings,
roster, chat), an AI vision pipeline extracts structured stats, and the app
turns that into dashboards, a "Conductor" rotation/points system, season
scoring, and various admin tools.

- Repo: `C:\Users\Frans en Renet\source\repos\alliance-stats-tracker` (Windows, Frans's own machine)
- Stack: Next.js 16 (App Router) + TypeScript, Prisma 7 + Postgres, Tailwind 4, `exceljs` for exports, `@google/genai` (Gemini) for vision extraction
- Deployed on Render: free web service, Frankfurt region. **Database is Neon** (confirmed by Frans 2026-09-02) — `render.yaml`'s comments still describe the DB as Render's own existing Postgres ("lastwar", set via Render's "Internal Database URL"), which is now stale; that comment should get corrected next time anyone touches `render.yaml`, but hasn't been yet.
- **As of 2026-09-04, also deployed on Vercel (Hobby plan)**, running side-by-side with Render against the **same production Neon database** (not a branch). Frans's stated intent is to migrate off Render onto Vercel — this isn't a throwaway comparison, it's the start of the actual cutover, just done gradually with both live at once for now. See "In-flight decisions" below for the deployment details and open follow-ups.

## How Claude works on this project — read this first

**Claude (this conversation) never writes directly to the live repo.** The
only access available is the device bridge, read-only:
`mcp__remote-devices__device_list_dir` and `device_stage_files` (which stages
files into `/mnt/user-data/uploads/alliance-stats-tracker/...` for reading).
There is no `device_bash` and no write-back tool.

> **Update (2026-09-02):** this session's device bridge *does* now expose
> `device_commit_files`, which can write files back into this repo (used to
> place this very memory file and `docs/PROJECT_MEMORY.md`). Treat that as
> narrow write access for docs/memory files only, not a green light to start
> writing code changes directly — keep using the spec workflow below for
> actual app changes unless Frans explicitly says otherwise.

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
- **Conductor points engine**: `lib/conductor/points.ts` — `pointsForCategoryWeek()` scores one member/category/week (`rate` = `(value/unitSize)*pointsPerUnit`, `flat` = fixed value if present that week). `computeStandings()` = `accumulated` (sum of earned points from `Setup → Conductor`'s `fromWeek` onward) minus `lessSelected` (sum of `ConductorSelection.pointsAtSelection`, frozen at each confirmed round). `recalculateSelectionPoints()` rebuilds those frozen values from real stats, chained per member in round-start order. **Live category config, confirmed from the Setup → Categories screenshot 2026-09-02** (this is admin-set DB data, not in `seed.ts`, so it's the kind of thing that can silently drift — worth re-confirming rather than trusting this note if it's been a while): Rate mode and scoring — Power (1 pt / 1,000,000), Kills (1 pt / 25,000), Donations (1 pt / 1,200), VS (1 pt / 1,250), Desert Storm (1 pt / 100,000). Flat mode — **Squads: flat 20 points** just for submitting a troop-comp report that week (per Frans directly; wasn't visible in the Setup → Categories screenshot he shared, so that screen apparently doesn't show every conductor-scoring category, or Squads' flat toggle lives somewhere else in that UI — not fully resolved). Off (don't score) — Alliance Exercise, HQ, **Canyon Storm**. Note: "Canyon Storm" appears in that live list where `seed.ts`'s `CATEGORIES` array has `squads` ("Squads") instead — `seed.ts` and the live `Category` table have diverged beyond just the admin-editable fields the reseed is known to preserve. Not investigated further; worth understanding before the next `seed.ts` change touches categories, in case a reseed would clobber something unexpected.
- **Conductor selection mechanics** (`lib/conductor/selection.ts`'s `generateDraft()`): a round covers a configurable number of weeks, one Conductor slot + one Passenger slot per day. Conductor is filled top-down from `computeStandings()` — highest balance first, skipping anyone already Conductor elsewhere in the round, must have real stats data that week to be eligible. Passenger is set per-weekday in Conductor Settings — either a specific category+rank ("whoever's #1 on Kills this week") or Random; Conductor and Passenger can never be the same person on the same day. **Two different points/ranking views exist, different audiences**: `/conductor/standings` (ADMIN/LEADER only, everyone's current total in one table) vs. `/dashboards/individual/statement` ("Conductor Statement" under Reports, MEMBER-visible — self-service, `MEMBER` only ever sees their own: current rank, week-by-week category breakdown, running balance, and the reset when they were last picked). Sent Frans a short member-facing explainer of all this on 2026-09-02 (`docs/` isn't the right home for it, it went straight to him — a game-facing announcement doc, not project documentation), pointing members at the Conductor Statement page for checking their own standing.
- **The recurring bug to always check**: whenever a new table gets a relation to `Member`, `app/api/users/merge/route.ts`'s move-or-drop logic needs a matching line, or merging two accounts crashes with a Postgres FK RESTRICT error. This has bitten this app multiple times already (`SeasonExtraValue`/`SeasonResult` were missed originally; `PivotView`/`FeedbackItem` needed it added when built). Current full list of Member-relation tables: `WeeklyStat, CategoryRecord, ConductorSelection, Suggestion, SeasonExtraValue, SeasonResult, PivotView, FeedbackItem` (+ `VisitLog` if that spec shipped). One later spec (the "Reject new user" fix) built a generic, schema-driven delete helper using `Prisma.dmmf` specifically to stop having to hand-maintain this list for *deletes* — worth reusing that technique again rather than another manual list.
- **UI conventions already established** — mirror these rather than inventing new patterns: role-scoped member picker (`MEMBER` only ever sees themselves, `ADMIN`/`LEADER` get a `<select>` to pick anyone — seen in `dashboards/individual/detail`, `dashboards/alliance/graphs`), GET-form-with-searchParams for report filters (bookmarkable, no client state needed), a `busy`/`saving` boolean + text-swap on every button that waits on a request (`ShareReportButton.tsx` is the reference), `ExcelExportButton` for exports, `ProgressBar` for longer operations, `DataTable`/`MobileCardList` for tabular reports.

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
- **Squads verification (2026-09-13)**: Squads (`free_text` shape) now routes through the same `ImportBatch`/`RawExtraction` pipeline every other `per_member`-verified category uses, instead of the old one-screenshot-at-a-time `pending_confirmation` flow. `Category.verificationMode` for `squads` is now `"per_member"` (was `"off"`) — set both in `prisma/seed.ts` (which now actively enforces `verificationMode` for entries that specify it, still hands-off for every other category) and live via a seed run. Adds field-level merge (`mergeFreeTextRows` in `lib/verify/validate.ts`) so a member's air/tank/missile/fourth split across multiple screenshots no longer overwrite each other, plus a dedicated post-commit-gate review step (`lib/verify/squadIssues.ts`, reached at `/verify/squads/review` or via VerifyDetailClient's Commit button when issues exist) flagging below-floor values, >10% drops from a member's own last submission, <3 of 4 squads read, or a member who submitted last week but not this one. `verificationMode: "per_member"` is now unlockable for any `free_text` category from Setup → Categories (previously hard-coded to `"off"` in three places — the two category API routes and `CategoryForm.tsx` — which was a landmine that would've silently reverted this on the next unrelated edit). Pushed to `master` (commit `0b560be`) — **not yet confirmed working by Frans**; next session should ask before assuming this is fully verified end-to-end (upload a real split-screenshot Squads scenario and check `/verify/squads/<week>` merges correctly).

Discussed but deliberately not built:
- Multi-alliance support (physical DB-per-alliance recommended if it's ever actually needed; explicitly deferred)
- A donate option under the Users screen (cost/effort discussed conversationally, no spec)
- A wishlist of future ideas — Weekly Wrap (AI-narrated, with a 5-week rolling trend), Badges & Streaks, "Your Journey" narrated, a public live leaderboard link, an At-Risk-Member signal — captured in a published artifact: **"RUNE Feature Dossier"**, `https://claude.ai/code/artifact/06a97832-8923-4a7e-9809-61fa4fa0c33c`. Worth checking whether it needs updating if new ideas come up.

## In-flight decisions

- **Render → Vercel migration, decided 2026-09-04.** Root problem that started this (raised 2026-09-02): Render free-tier's ~50s cold start, caused by the web service spinning down after 15 min idle — not Neon, whose own autosuspend wakes in a few hundred ms. Recommended fix was moving compute to Vercel Hobby (no persistent container to sleep; Fluid Compute's 300s/5min function duration comfortably covers the Gemini vision calls; `@prisma/adapter-pg` + `pg` work unchanged against Neon's pooled `-pooler` connection string). **Frans has now decided to go ahead** — a spec for this exists at `docs/vercel-trial-deploy-spec.md` (written when this was framed as a side-by-side trial; the plan/setup steps in it are still accurate even though Frans's intent has since firmed up into "actually migrating," not just comparing).
  - **Current status**: first Vercel deploy is live and Frans has confirmed the app works there. Both Render and Vercel are running side-by-side against the **same production Neon database** (Frans's choice, not the spec's isolated-branch option) — so anything done on either deployment (uploads, edits) is real production data, and there's no test/prod separation between the two right now.
  - **Deploy fix needed to get the first build working**: Vercel's default Next.js build doesn't run `prisma generate` the way Render's explicit `buildCommand` (`npm ci && npx prisma generate && npm run build`, see `render.yaml`) does, so the build failed with `Module not found: Can't resolve '@/lib/generated/prisma/client'`. Fixed for now via a **Vercel dashboard override**: Project Settings → Build and Deployment → Build Command → `prisma generate && next build`. `package.json` also already has `"postinstall": "prisma generate"` (added per the trial spec) — the intended durable, portable fix — but the first deploy failed even with that line present in the local repo, which most likely means it hadn't been pushed to GitHub yet at deploy time. **Not yet confirmed**: whether that postinstall line is actually committed/pushed now. If it is, the dashboard override is redundant-but-harmless; if it isn't, the dashboard override is the only thing making the build work and must not be removed until the postinstall line is confirmed live on GitHub.
  - **Not yet confirmed**: whether `DATABASE_URL` on Vercel is using Neon's **pooled** (`-pooler`) connection string as the spec calls for. This matters more on Vercel than it did on Render — serverless functions can each open their own DB connection, and Neon's direct endpoint has a low connection ceiling that can get exhausted under that pattern ("too many connections" errors). Worth checking Vercel's env vars next time this comes up.
  - **Not yet decided**: when/whether to shut down Render, or keep it as a spare. Also unresolved from the original diagnosis: the local-disk screenshot upload bug (see Known operational gotchas below) — this becomes more urgent the more traffic shifts to Vercel, since Vercel's serverless filesystem is even less persistent than Render's.

## Known operational gotchas

- The Conductor "From week" setting and the "Recalculate selection points" button live in *different sections* of the same Setup → Conductor page, each with its own Save/action button — it's easy to change "From week" and click Recalculate without actually saving the setting first, which looks like nothing happened.
- Changing "From week" **without** recalculating afterward will produce negative standings totals for anyone already selected as Conductor, because their frozen reset amount was computed under the old baseline. Always recalculate right after changing it.
- Password reset: there was no self-service recovery until the Forgot Password spec — until that's deployed, a locked-out admin's only path back in is direct SQL against the Neon dashboard's SQL editor (format: `scrypt` `salt:hash`, computed locally with Node's built-in `crypto`).
- Render's Cron Job service type needs a paid plan (checked directly against Render's current pricing: $1/month minimum) — the app is on the free web-service plan, so anything needing a schedule should use a free external trigger (cron-job.org, or a scheduled GitHub Actions workflow in the repo) hitting a secret-protected route, not a Render Cron Job, unless Frans says the small cost is fine.
- **`app/api/upload/route.ts` writes uploaded screenshots to local disk** (`public/uploads/...`, via `fs/promises.writeFile`) and stores that path in `RawExtraction.imageFilename` (and the season-item equivalent) for later review. Render's free tier wipes local filesystem changes on every spin-down/redeploy, so these files are almost certainly already going missing today — and now that Vercel is also live (see In-flight decisions), this is worse there: Vercel's serverless functions have no persistent disk across invocations at all, not even the "survives until next spin-down" behavior Render has. Found 2026-09-02 while investigating the deployment-latency issue; not yet fixed or spec'd. Fixing it for real needs actual object storage (Cloudflare R2's free tier — 10GB, free egress — is the natural fit) since no free serverless host has writable persistent disk either.
- **Vercel doesn't run `prisma generate` by default the way Render's explicit `render.yaml` buildCommand does.** Without it, the build fails with `Module not found: Can't resolve '@/lib/generated/prisma/client'` (this repo uses a custom Prisma client output path, not the `node_modules/.prisma` default). The portable fix is a `"postinstall": "prisma generate"` script in `package.json` (present as of 2026-09-04); the immediate fix that actually got the first Vercel deploy working was overriding the Build Command in Vercel's dashboard to `prisma generate && next build`. See In-flight decisions above for the unresolved question of whether the postinstall line alone would now be sufficient.

## Style notes for whoever picks this up

Frans wants specs grounded in the *actual current code* — exact file paths, exact line numbers, exact snippets to add — not generic scaffolding. He pushes back (rightly) when a diagnosis turns out to be guesswork instead of based on a real error log or a real file read. He's fine with being told "I found a related gap but didn't fix it, tell me if you want it too" rather than scope creeping into things he didn't ask for. Ask a real clarifying question when a decision is genuinely his to make (permissions, scope, UX trade-offs) — but don't ask when the answer is obvious from the existing codebase's own conventions.

---

## About starting a Project for this

Yes, a Claude **Project** would help, but it's worth being precise about
*why*, so it's used the right way:

- What it actually fixes: each new conversation inside a project starts
  fresh and small — it doesn't inherit this entire conversation's history,
  so token usage per message drops and responses in a new chat aren't
  competing with months of accumulated back-and-forth for context space.
  The project's custom instructions and any knowledge files (like this one)
  get pulled in automatically, so Claude has the orientation without you
  re-explaining the setup every time.
- What it does *not* fix: a knowledge file is a static snapshot. It captures
  conventions, history, and decisions — it does not know what the live code
  looks like today. For anything beyond a quick question, Claude in a fresh
  conversation still needs to re-stage and re-read the actual current files
  through the device bridge before proposing a fix, exactly like this
  conversation has done every single time. This file should make that
  faster to get into, not replace it.
- Practically: create the Project, attach this file as project knowledge,
  and start new conversations there for new work on this app. It's worth
  refreshing this file occasionally (say, after a batch of specs ships) so
  it doesn't quietly go stale the way the seed data's category names did.

---

## Maintenance note (added 2026-09-02)

This file now lives in two places that Claude is responsible for keeping in
sync going forward:

1. **This repo**, at `docs/PROJECT_MEMORY.md` (this file), and imported into
   `CLAUDE.md` so the separate Claude Code session on Frans's machine picks
   it up automatically on every run — no re-pasting needed.
2. **The "Last War App" Claude Project's knowledge**, as a project doc
   (written via the `Projects` tool), so it's read/searched automatically at
   the start of new chats in that Project.

The Project's *custom instructions* field (the text Frans originally pasted
in when setting up the Project) is a third, separate copy that Claude
**cannot** edit directly — there's no tool access to it. When this file
changes materially, Claude should say so and offer Frans the updated text to
paste into the Project's custom instructions if he wants that copy current
too; otherwise the project doc and repo copy are the ones Claude keeps
authoritative.

**Standing instruction:** whenever a spec ships and Frans confirms it's
deployed and working, or a new architectural decision/convention/gotcha
comes up worth remembering, Claude updates both copies (repo file + project
doc) in the same conversation, not just the local chat.
