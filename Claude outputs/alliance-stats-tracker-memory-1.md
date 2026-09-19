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
- **No Prisma migrations folder** — `prisma/` only has `schema.prisma` and `seed.ts`, no `prisma/migrations`. Schema changes go out via `npx prisma db push` (+ `npx prisma generate`), not `prisma migrate dev`. Any spec that changes the schema should say `db push`, not migrate.

## How Claude works on this project — read this first

**Claude (this conversation) never writes directly to the live repo.** The
only access available is the device bridge, read-only:
`mcp__remote-devices__device_list_dir` and `device_stage_files` (which stages
files into `/mnt/user-data/uploads/alliance-stats-tracker/...` for reading).
There is no `device_bash` and no write-back tool.

The actual workflow, every time:
1. Frans describes a bug or a feature.
2. Claude stages and reads the *real, current* source files relevant to it — never guesses from memory of an earlier read, since the live repo keeps changing between conversations.
3. Claude writes a precise Markdown spec (exact file paths, exact line numbers, exact code to add/change, and *why*) and delivers it via `Write` + `SendUserFile` — **including a step to bump `lib/version.ts`** (see the version-number note in the cheat-sheet below) for any change worth marking.
4. A **separate Claude Code session running directly on Frans's machine** implements and deploys the change from that spec. Claude here does not do this part.
5. Frans reports back (works / doesn't / new symptom), and Claude re-stages and re-reads the live files to confirm or keep digging.

Keep doing it this way unless Frans explicitly says the setup has changed.

## Core architecture cheat-sheet

- **Auth**: `lib/auth/session.ts` (JWT in an httpOnly cookie via `jose`), `lib/auth/password.ts` (Node `scrypt`, format `salt:hash`, not bcrypt). `Member` *is* the login identity — `Member.id` is the user id everywhere. Roles: `ADMIN | LEADER | MEMBER`, resolved by `lib/auth/roles.ts`'s `effectiveRole()` — a manual `Member.role` override wins; otherwise `allianceRank R4/R5 → LEADER`, else `MEMBER`. `lib/auth/dal.ts` has the guard helpers: `requireRole`/`requireAdmin` (Server Components, redirect), `requireAdminApi`/`requireAuthApi` (Route Handlers, JSON 401/403).
- **Menu system**: `prisma/seed.ts`'s `MENU_ITEMS` array is the fail-closed source of truth for every nav entry (`key, label, href, roles, parentKey`). Re-synced on every deploy — only the `roles` field is preserved across reseeds (admin-editable via the Menu Access page); everything else is code-owned. A page with no `MenuItem` row is invisible in nav even if it exists and is reachable by direct URL.
- **Categories**: `Category` model — `key`, `name`, `shape` (`ranking_list` | `roster` | `free_text`), `divisor`, `cumulative` (lifetime-running-total categories get week-over-week diffed, not read raw), and `conductorMode` (`off | rate | flat`) + `conductorPointsPerUnit`/`conductorUnitSize`/`conductorFlatValue` for the points engine. Seeded list is in `prisma/seed.ts`'s `CATEGORIES` array — **this upsert overwrites `name`/`description`/etc. on every deploy**, so an admin can't durably rename a category from the UI; it has to change at the seed source.
- **Cumulative-category gain math is duplicated across ~5 call sites**, each already correctly treating "no prior reading" as safe (either `0` for scoring or "excluded/blank" for display) rather than the raw lifetime value: `lib/conductor/stats.ts` (scores 0), `app/reports/leaderboard/page.tsx`, `app/reports/new-records/page.tsx`, `lib/dashboards/allianceDetail.ts` (`gain()`), `lib/dashboards/categoryGraph.ts`. Audited Sep 2026 while fixing the one place that displayed the "no prior reading" case badly (`lib/dashboards/individualGrowth.ts`, used by `/dashboards/individual/detail` — a brand-new member's first Kills reading now shows "New" instead of a blank dash; see the Sep 2026 spec). Worth eventually consolidating into one shared helper rather than continuing to hand-duplicate it, but not done yet — flagged, not fixed.
- **AI extraction pipeline**: `lib/ai/{prompts,extract,classify}.ts` (Gemini vision) → `lib/pipeline/run.ts` (`runPipelineForImage`) → `lib/pipeline/matchMember.ts` (fuzzy-matches the extracted name against the roster, Unicode-safe normalize + Levenshtein within ~20% of name length, auto-creates a new `Member` with `nameConfirmed: false` if nothing matches closely enough). `buildExtractionPrompt()` (Sep 2026, confirmed deployed) now explicitly tells the model to include a small superscript/suffix name badge as part of the name rather than dropping it. A separate, harder case — a name made of heavily garbled/mixed-script Unicode glyphs read inconsistently between imports — is a Gemini model-capability limit, not something prompt wording fixes; the only lever is `GEMINI_MODEL` (env var only, no DB/UI setting).
- **Roster/active-member filtering has two differently-scoped, identically-named functions** — a pre-existing collision, not something introduced by any spec: `lib/reports/activeMembers.ts`'s `getActiveMemberIdsForWeek()` ("has a recorded value this week," used by reports) vs. `lib/members/weekActivity.ts`'s `getActiveMemberIdsForWeek()` ("has a WeeklyStat/CategoryRecord row this week," used by active-status syncing). Flagged Sep 2026, not fixed — worth a rename if anyone's ever in that code for another reason.
- **Conductor points engine**: `lib/conductor/points.ts` — `pointsForCategoryWeek()` scores one member/category/week (`rate` = `(value/unitSize)*pointsPerUnit`, `flat` = fixed value if present that week). `computeStandings()` = `accumulated` (sum of earned points from `Setup → Conductor`'s `fromWeek` onward) minus `lessSelected` (sum of `ConductorSelection.pointsAtSelection`, frozen at each confirmed round). `recalculateSelectionPoints()` rebuilds those frozen values from real stats, chained per member in round-start order.
- **The recurring bug to always check**: whenever a new table gets a relation to `Member`, `app/api/users/merge/route.ts`'s move-or-drop logic needs a matching line, or merging two accounts crashes with a Postgres FK RESTRICT error. This has bitten this app multiple times already (`SeasonExtraValue`/`SeasonResult` were missed originally; `PivotView`/`FeedbackItem` needed it added when built). Current full list of Member-relation tables: `WeeklyStat, CategoryRecord, ConductorSelection, Suggestion, SeasonExtraValue, SeasonResult, PivotView, FeedbackItem` (+ `VisitLog` if that spec shipped). `ImportJob`/`ImportJobItem` (added Sep 2026, see below) deliberately have **no** relation to `Member` specifically to stay out of this list — they're a system-scoped batch/queue table, not member data. One later spec (the "Reject new user" fix) built a generic, schema-driven delete helper using `Prisma.dmmf` specifically to stop having to hand-maintain this list for *deletes* — worth reusing that technique again rather than another manual list.
- **UI conventions already established** — mirror these rather than inventing new patterns: role-scoped member picker (`MEMBER` only ever sees themselves, `ADMIN`/`LEADER` get a `<select>` to pick anyone — seen in `dashboards/individual/detail`, `dashboards/alliance/graphs`), GET-form-with-searchParams for report filters (bookmarkable, no client state needed), a `busy`/`saving` boolean + text-swap on every button that waits on a request (`ShareReportButton.tsx` is the reference), `ExcelExportButton` for exports, `ProgressBar` for longer operations, `DataTable`/`MobileCardList` for tabular reports.
- **Version number**: `lib/version.ts` holds `MAJOR`/`MINOR` constants rendered in the app header as `MM.NNNN` (e.g. `02.0022`) — the file's own comment says to bump `MINOR` by 1 (reset to 0 and bump `MAJOR` instead, for a bigger milestone) "as part of the commit for any change worth marking." **Every spec Claude writes for a Claude Code session to implement must include this bump as one of the listed steps** — it's how Frans confirms from the running app that a deploy actually picked up the change, not just that the deploy succeeded.
- **Platform gotcha: Vercel's serverless functions have a read-only filesystem outside `/tmp`.** Anything that used to write to local disk on Render (e.g. the original `/api/upload` route saving screenshots under `public/uploads`) will crash on Vercel — the request throws before a response is sent, which the browser sees as an empty/unparseable JSON response. Any feature that needs to persist an uploaded file for later display must use Vercel Blob (`@vercel/blob`'s `put()`, returns a public URL) instead of the filesystem. This bit the main Import screen once already; check for the same pattern before shipping any other upload/import feature.
- **Background/async work pattern (Sep 2026): Next's `after()` (from `next/server`) + a DB-tracked job/queue table, not a client-driven loop.** The screenshot import used to be entirely client-driven (a browser `for` loop awaiting one `/api/upload` request per file) — this broke whenever the tab was backgrounded or the phone switched apps, since mobile browsers throttle/suspend a backgrounded tab's JS. Fixed by moving real processing server-side: an `ImportJob`/`ImportJobItem` pair of tables tracks a batch, a route handler kicks off processing via `after()` (runs after the response is already sent, within that route's `maxDuration`), and a `/api/import/resume` endpoint (hit by an external cron — cron-job.org, not Vercel's own Cron Jobs, to sidestep its plan-based frequency limits — plus an on-mount client nudge) picks up anything left `"queued"` if a single invocation's time budget runs out mid-batch. **Confirmed deployed and live.** This is the reusable pattern for any future feature that needs to survive the browser tab going away — don't reinvent a client-driven loop for it.
- **Follow-up fix, confirmed deployed (Sep 2026): the first version of the above bundled every selected file into one multipart `/api/import/start` request** — worked for small batches but hit Vercel's hard 4.5MB serverless body-size limit at 7+ screenshots, surfacing to Frans as a non-JSON `Unexpected token 'R', "Request En"...` error. Fixed by switching to Vercel's officially recommended client-direct-to-Blob pattern: `@vercel/blob/client`'s `upload()` from the browser (through a new `/api/import/blob-upload` route implementing `handleUpload()`) sends file bytes straight to Blob storage, never through the Next.js function; `/api/import/start` now just creates an empty `ImportJob` up front, and a new tiny-JSON `/api/import/[jobId]/items` route registers each `ImportJobItem` as its upload finishes. `processImportJob`'s "is the job done" check was also changed from "no items left un-done" to `processedFiles >= totalFiles` (known from the very first `/start` call), since items now register incrementally instead of all existing before processing starts.
- **Follow-up fix, confirmed deployed (Sep 2026): the "leave anyway?" navigation warning could get stuck on globally.** Moving "is the import done" detection into a status-polling `useEffect` (as part of the above redesign) meant that if the user navigated away while an import was still running (confirming the warning once, as intended), `UploadClient` unmounted before either of its two `setBlock(false)` call sites could fire — leaving the app-wide `NavigationBlockerContext` stuck `isBlocked: true` forever, so every future in-app navigation anywhere else showed the same stale Import warning. Fixed with an unmount-cleanup effect (`useEffect(() => () => setBlock(false), [])`, empty deps deliberately since `setBlock` isn't `useCallback`-stabilized).

## What's shipped, what's specced-but-unconfirmed

Confirmed live and working (Frans has used them / re-verified them):
- Alliance tag as a case-insensitive `Setting` (fixed the original "0 points" Capture bug)
- Merge route handling `SeasonExtraValue`/`SeasonResult`
- Backup & Restore under Setup (`settings-backup` menu item)
- Custom Pivot & Saved Views (`/dashboards/pivot`)
- Bug Report & Feature Request (`/feedback`) — admin-only edit/delete/status, not just ADMIN-or-LEADER
- Conductor Points Statement (`/dashboards/individual/statement`) — the ledger/audit view
- New member's first Kills reading showing "New" instead of a blank dash on `/dashboards/individual/detail` (see the cumulative-gain audit note above)
- Import surviving the browser tab going away, plus its two follow-up fixes (the 4.5MB body-size regression, and the stuck navigation-warning bug) — see the background/async-work-pattern bullets above
- Name-recognition superscript/suffix-badge prompt fix (see the AI extraction pipeline bullet above)
- Name-reading accuracy fix: disabled Gemini's default "thinking" tokens (`thinkingBudget: 0`), explicit `maxOutputTokens: 8192`, `mediaResolution: "MEDIA_RESOLUTION_HIGH"`, throws → needs_review on `finishReason === "MAX_TOKENS"` instead of silently truncating; plus the Unicode-code-point-safe Levenshtein fix in `matchMemberCore.ts`
- Rolling roster filter (current week + last completed week) so departed/ghost members stop appearing in multi-week reports — applied to Leaderboard's "All time" panels (`getAllTimeBestWeek`/`getLatestCumulative`, previously had zero member filtering at all) and `lib/dashboards/allianceDetail.ts` (widened from a single-week to a 2-week window); new shared helper `getRosterMemberIdsForWeeks()` in `lib/reports/activeMembers.ts`. HQ/Squad Power/R1/New Records/MVP/Clubs were audited and already excluded departed members correctly on their own — no change needed there.

Specced and delivered, **not yet confirmed deployed** as of the last check-in:
- HQ category mis-named "Members" → rename fix in `prisma/seed.ts`
- Arabic (and any non-Latin-script) member names getting mis-transcribed by the AI extraction prompt, causing duplicate "ghost" members instead of matching the real one
- Visit Tracker: owner-only (`OWNER_MEMBER_ID` env var, not just ADMIN role, since other admins exist) login log, delivered as a periodic email digest via Resend rather than an in-app page
- Forgot Password flow: self-invalidating signed tokens (no new table), emails a reset link to `Member.contactEmail`
- "Reject" button for unconfirmed/"New" auto-created members (full cascade delete via the DMMF-driven helper mentioned above)
- Recalculate-selection-points performance fix (was doing hundreds of sequential row updates in a `$transaction` array — replaced with one bulk `UPDATE ... FROM (VALUES ...)` statement)
- Conductor Statement follow-ups: Detail/Summary view toggle, pivoted single-sheet export (one row per week, one column per category), and **rank per week** (not just current rank) — computed efficiently via one cumulative-balance array per member, not a per-week recomputation
- **Vercel import fix**: `/api/upload` no longer writes screenshots to local disk (broke on Vercel — see platform gotcha above); switched to Vercel Blob (`put()`), with `app/raw/page.tsx`'s thumbnail check updated to match a URL instead of the old `/uploads/` path. Requires the Blob store to be connected on the Vercel project (adds `BLOB_READ_WRITE_TOKEN` automatically) and `npm install @vercel/blob`.
- **Actionable review screen**: `needs_review` results (classification/extraction failures) were previously a dead-end - no link, and `/review` only ever showed `pending_confirmation` items. Specced: the Upload results list now links "needs review"/"error" labels to `/review`; `/review` fetches both statuses and shows a needs_review card with the actual screenshot image, a category picker, and Reprocess/Reject actions (new `reprocessNeedsReview()` in `lib/pipeline/run.ts` re-fetches the image from its stored Blob URL and re-runs extraction against the admin-chosen category). True crop-to-region isn't possible without bounding-box data from the AI - deliberately out of scope, full image shown instead. Not yet confirmed deployed.
- **Login by alias/email/phone**: members with non-Latin/hard-to-type screen names can now log in via a separate `loginAlias` field (plain ASCII, set by the member via Account or an admin via Setup → Users) or their existing `contactEmail`/`contactWhatsapp`, in addition to the screen name - `Member.name` itself is untouched, so reports keep showing the real screen name always. Requires a migration (`loginAlias` new column; `contactEmail`/`contactWhatsapp` made unique - check for pre-existing duplicates first). Not yet confirmed deployed.
- **Merge page list split**: the Merge page's Keep/Merge-away pickers were one flat alphabetical list of every member ever. Specced: `GET /api/users` now also returns `recentlyActive` (union of `getActiveMemberIdsForWeek()` over the last 3 completed weeks, reusing the existing "last completed week" anchor from `syncMemberActiveStatus()`), and `MergeClient.tsx` splits both dropdowns into "Active in the last 3 weeks" / "Everyone else" `<optgroup>`s. Not yet confirmed deployed.
- **Users/Merge page fixes (4 parts)**: (1) Confirm/Reject on Setup → Users was refetching+re-rendering the whole table via a `loading` flag on every action, collapsing it to "Loading…" and back - looked like a page refresh and lost scroll position; fixed by updating the affected row locally instead of refetching. (2) Found a real, structural bug in `matchMemberCore.ts`'s fuzzy-match threshold: `Math.max(1, ...)` means any two names with edit distance ≤1 always auto-match regardless of length - confirmed this is almost certainly why a new "minktest" member's data got silently combined into an existing "Inktest" (distance 1, computed threshold 1). Fix requires exact match for short (<8 char) normalized names; longer names keep proportional typo tolerance. Includes a `RawExtraction.rawJson` SQL query to find/recover the specific minktest case - that part is a manual one-off, not automated. (3) Added a "Rename" option next to Merge for the one-real-person-misread-name case (`Member.name` update - reports already join on memberId so this is automatic - old name preserved as an alias so future OCR hits still match). (4) Diagnosed "confirmed but still greyed out": row dimming is driven by `isActive` (last-completed-week data), completely unrelated to `nameConfirmed` - a brand-new member can't be "active" until they've had one full completed week regardless of confirmation. Added an `everHadCompletedWeek` distinction so a genuinely brand-new member shows a "New" badge instead of reading as "Inactive." None of the 4 parts confirmed deployed yet.
- **New members locked out of login entirely (real bug, not cosmetic)**: role auto-assignment (`effectiveRole()` off `allianceRank`) already worked automatically and needed no fix. First pass called the Users screen's "No access" label a cosmetic gap (a working general-password fallback just wasn't being reported) - Frans caught that this was wrong with a concrete case (a brand-new member couldn't sign in with the general password at all, only fixed by setting an individual password), which led to the real root cause: `app/login/actions.ts` gates login on `member.isActive` *before* any password check runs, and `lib/members/activeSync.ts`'s `syncMemberActiveStatus()` (which runs on every Setup → Users page load) flips a member to `isActive: false` the moment they have zero data in the single last completed week - with no exemption for a member who simply hasn't had a completed week yet. Net effect: a brand-new member gets silently locked out of login (general *and* individual password, both blocked identically by the `isActive` gate) the first time an admin opens Setup → Users after they're created - almost certainly also the real explanation for "no access for almost everybody," since any member who just missed one recent week hits the same lockout. Same underlying flag as the earlier "confirmed but still greyed out" bug (Users/Merge fixes Part 4) - that spec only fixed the display, not the login lockout. Fix: `syncMemberActiveStatus()` now (a) requires 2 consecutive completed weeks with zero data before flipping an existing member to Inactive, and (b) never evaluates - and so never deactivates - a member with no completed-week history at all, via a new `getMemberIdsWithHistoryThroughWeek()` helper in `lib/members/weekActivity.ts`; a fresh member's `isActive: true` default is left untouched until they've had a fair first week. The `GET /api/users` / `UsersClient.tsx` "No access" → three-state Login badge fix (Has password / Uses general password / No access) still stands as a separate, real improvement on top. Not yet confirmed deployed.
Filed for later review, **not implemented yet** (see `new features/` folder in the repo):
- **Video-upload feature**: upload a screen recording instead of individual screenshots. Gemini's File API ingests the whole video once; a new "segment scan" prompt identifies every distinct data screen and its time range; each segment then runs through the *existing* per-category extraction prompts/schemas, just pointed at a clipped video time range (`videoMetadata.startOffset`/`endOffset`) instead of a still image, writing results exactly like a normal screenshot import. Requires a schema change (`ImportJobItem` gains `geminiFileUri`/`videoClipStart`/`videoClipEnd` nullable columns and an `"expanded"` resultStatus), new `uploadVideoToGemini()`/`generateJsonFromVideo()` in `lib/ai/gemini.ts`, and a 3-way branch in `processImportJob` (plain screenshot / fresh video needing a scan / already-scanned video segment). Two open questions flagged before wide rollout: Gemini bills video by tokens-per-second (no verified cost comparison to screenshots yet — test one short recording and check the AI Studio usage dashboard first), and processing time (upload + scan + N extractions) will likely need more than one `maxDuration` window per video even after raising it to 120s, relying on the existing resume-cron to finish the rest.
- **Spec-filing convention (Sep 2026)**: a spec meant for later review rather than immediate implementation gets written to a `new features` folder inside the repo (in addition to being handed to Frans as a downloadable file), so it doesn't get lost between conversations. The normal handoff-to-a-separate-Claude-Code-session workflow (see "How Claude works on this project" above) still applies once Frans decides to actually build it.

Discussed but deliberately not built:
- Multi-alliance support (physical DB-per-alliance recommended if it's ever actually needed; explicitly deferred)
- A donate option under the Users screen (cost/effort discussed conversationally, no spec)
- A wishlist of future ideas — Weekly Wrap (AI-narrated, with a 5-week rolling trend), Badges & Streaks, "Your Journey" narrated, a public live leaderboard link, an At-Risk-Member signal — captured in a published artifact: **"RUNE Feature Dossier"**, `https://claude.ai/code/artifact/06a97832-8923-4a7e-9809-61fa4fa0c33c`. Worth checking whether it needs updating if new ideas come up.

## Known operational gotchas

- The Conductor "From week" setting and the "Recalculate selection points" button live in *different sections* of the same Setup → Conductor page, each with its own Save/action button — it's easy to change "From week" and click Recalculate without actually saving the setting first, which looks like nothing happened.
- Changing "From week" **without** recalculating afterward will produce negative standings totals for anyone already selected as Conductor, because their frozen reset amount was computed under the old baseline. Always recalculate right after changing it.
- Password reset: there was no self-service recovery until the Forgot Password spec — until that's deployed, a locked-out admin's only path back in is direct SQL against the Neon Postgres dashboard (format: `scrypt` `salt:hash`, computed locally with Node's built-in `crypto`).
- Any local-disk write in an API route is a Vercel landmine (see platform gotcha above) — this already broke the main screenshot import once; check new upload/export/report-generation features for the same assumption before they ship.
- Scheduling/background work: Vercel's own Cron Jobs has frequency/invocation caps that differ by plan - this project's convention (established for the import-resume safety net, Sep 2026) is a free external trigger (cron-job.org, or a scheduled GitHub Actions workflow) hitting a secret-protected route instead, rather than relying on Vercel Cron Jobs directly. Re-check Vercel's current Cron Jobs limits only if there's a specific reason to prefer Vercel's own over the external-cron pattern already in use.

## Style notes for whoever picks this up

Frans wants specs grounded in the *actual current code* — exact file paths, exact line
numbers, exact snippets to add — not generic scaffolding. He pushes back (rightly) when a
diagnosis turns out to be guesswork instead of based on a real error log or a real file
read. He's fine with being told "I found a related gap but didn't fix it, tell me if you
want it too" rather than scope creeping into things he didn't ask for. Ask a real
clarifying question when a decision is genuinely his to make (permissions, scope, UX
trade-offs) — but don't ask when the answer is obvious from the existing codebase's own
conventions.

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
