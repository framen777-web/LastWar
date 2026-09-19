# Users/Merge page fixes: scroll jump, stricter name-matching, rename, and the "still greyed out" confusion

For the Claude Code session on Frans's machine. Four independent parts —
implement in any order. Part B (matching threshold) and Part D (active
badge) both touch fields already being added by earlier specs on the same
files (`recentlyActive` from `merge-list-recent-split-spec.md`, `loginAlias`
from `review-screen-and-login-alias-spec.md`) - each part below says
exactly how to layer with those if they've already landed.

---

# Part A: Confirm/Reject "refreshing" and losing your scroll position

## Root cause (found by reading the actual render logic, not a guess)

`app/setup/users/list/UsersClient.tsx`'s `load()` (lines 28-35) sets
`loading` to `true` at the start of every reload, and every action handler
(`patchUser`, `rejectUser`) calls `await load()` when it finishes. The
render (lines 105-107) is gated on that flag:

```tsx
{loading ? (
  <p className="text-neutral-500 text-sm">Loading…</p>
) : ( <table>...</table> )}
```

So every single Confirm/Reject/role-change/password-set collapses the
*entire table* down to one line of text, then a moment later replaces it
with the freshly-fetched table again. The page never actually navigates or
scrolls itself to the top - but the content you were looking at disappears
and reflows, which is indistinguishable from a refresh and is exactly why
you land somewhere else and have to scroll back down.

## Fix: update the row locally instead of refetching the whole list

The PATCH/DELETE responses already tell you what changed - there's no need
to re-fetch and re-render everything. Replace `patchUser` and `rejectUser`:

```ts
import { effectiveRole } from "@/lib/auth/roles";
```

```ts
async function patchUser(id: number, body: Record<string, unknown>) {
  setBusyId(id);
  setError(null);
  const res = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    setError(data.error ?? "Something went wrong.");
  } else {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u;
        const updated = { ...u };
        if ("nameConfirmed" in body) updated.nameConfirmed = body.nameConfirmed as boolean;
        if ("isActive" in body) updated.isActive = body.isActive as boolean;
        if ("password" in body) updated.hasPassword = true;
        if ("role" in body) {
          updated.roleOverride = body.role as Role | null;
          updated.effectiveRole = effectiveRole({ role: updated.roleOverride, allianceRank: updated.allianceRank });
        }
        return updated;
      })
    );
  }
  setBusyId(null);
}

async function rejectUser(id: number, name: string) {
  const proceed = confirm(
    `Reject "${name}"? This permanently deletes this member and every stat/record attached to their name. This cannot be undone. If this is actually an existing member under a misread or misspelled name, use Merge instead of Reject.`
  );
  if (!proceed) return;

  setBusyId(id);
  setError(null);
  const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setError(data.error ?? "Something went wrong.");
  } else {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }
  setBusyId(null);
}
```

No more `await load()` in either function, so `loading` only ever gets set
during the true initial page load - the table stays mounted and in place
through every action from here on, and your scroll position never moves
out from under you. (`load()` itself is untouched, still used by the
initial `useEffect`.)

---

# Part B: stop short-name lookalikes from silently merging (the minktest/Inktest case)

## Diagnosis

I can't query your live database directly, so I can't personally confirm
this specific pair collided - but the math is exact, and it explains
"minktest is missing, don't confuse with Inktest" precisely.
`lib/pipeline/matchMemberCore.ts`'s fuzzy-match threshold (line 71) is:

```ts
const threshold = Math.max(1, Math.round(normalized.length * MATCH_THRESHOLD_RATIO)); // ratio 0.2
```

Normalize "Inktest" → `inktest` (7 chars) and "minktest" → `minktest` (8
chars). The edit distance between them is exactly 1 (drop the leading "m").
Threshold for a 7-character name: `max(1, round(7 * 0.2))` = `max(1, 1)` =
**1**. Distance (1) ≤ threshold (1) → **auto-match**. Any screenshot where
the AI read "minktest" would have silently been attributed to the existing
"Inktest" member instead of creating a separate person - no warning, no
review, because this path is specifically the "confident enough, just
write it" branch, not the needs_review/pending_confirmation path.

This isn't unique to this pair - the `Math.max(1, ...)` floor means *any*
two names with edit distance ≤ 1 will always auto-match regardless of
length, because the minimum allowed distance is never 0. Two totally
different short handles that happen to differ by one letter ("Neo"/"Leo",
"Kim"/"Tim") would silently combine the same way. That's a much bigger
risk than it looks like from one incident.

### Fix — tighten the threshold for short names

This also folds in the Unicode-safety fix from `screenshot-accuracy-fix-
spec.md` (code-point-safe Levenshtein) - if that spec hasn't shipped yet,
this version supersedes it; if it has, this is what the file should look
like after both fixes:

```ts
const MATCH_THRESHOLD_RATIO = 0.2;
// Below this many (code-point) characters, only an exact normalized match auto-links to an
// existing member. A 1-character difference in a short name is often a genuinely different
// person ("Inktest" vs "minktest": edit distance 1, which the old ratio-only threshold rounded
// up to "close enough" and silently combined two different people's stats) rather than OCR
// noise. Longer names keep proportional typo tolerance, since a 1-2 character slip on a long
// name is far less likely to coincidentally land on a different real person's name.
const MIN_LENGTH_FOR_FUZZY_MATCH = 8;

export type MatchableMember = { id: number; name: string; aliases: string };

export function hasAllianceTag(extractedTag: string | null | undefined, allianceTag: string): boolean {
  if (!extractedTag) return false;
  return extractedTag.trim().toLowerCase() === allianceTag.trim().toLowerCase();
}

export function stripAllianceTag(name: string): string {
  return name.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

export function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

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

export function findMemberId(rawName: string, members: MatchableMember[]): number | null {
  const trimmedName = stripAllianceTag(rawName);
  const normalized = normalize(trimmedName);
  const normalizedLength = Array.from(normalized).length;

  let best: { id: number; distance: number } | null = null;
  for (const member of members) {
    const candidates = [member.name, ...member.aliases.split(",").map((a) => a.trim())].filter(Boolean);
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedCandidate === normalized) {
        return member.id;
      }
      const distance = levenshtein(normalized, normalizedCandidate);
      if (!best || distance < best.distance) {
        best = { id: member.id, distance };
      }
    }
  }

  const threshold =
    normalizedLength >= MIN_LENGTH_FOR_FUZZY_MATCH ? Math.max(1, Math.round(normalizedLength * MATCH_THRESHOLD_RATIO)) : 0;
  if (best && best.distance <= threshold) {
    return best.id;
  }

  return null;
}
```

Trade-off, stated plainly: this will create a few more "New" members that
need a manual Confirm/Merge going forward, for short names that are
genuinely close typos of an existing member. That's the right direction to
err in - a "New" row sits there safely until reviewed; a wrong silent merge
quietly corrupts two people's history together and is exactly what you just
found happening.

## Recovering the specific minktest/Inktest case

This part isn't a code change - it's a one-off data check, best run by
whoever has direct Postgres access to the Neon database (the Claude Code
session implementing this, or you directly via Neon's SQL console).
`RawExtraction.rawJson` stores the literally-extracted JSON per screenshot,
including the `member_name`/`name` string as it was read *at the time* -
that's your audit trail, independent of whatever `matchMember` later
decided to do with it:

```sql
-- Every extraction where the AI actually read "minktest" (case-insensitive,
-- across both possible JSON key names depending on category shape)
select id, "categoryKey", "weekNumber", "createdAt", "rawJson"
from "RawExtraction"
where "rawJson" ilike '%minktest%'
order by "weekNumber";
```

That tells you exactly which weeks contained a "minktest" reading. Cross-
reference those weeks against the `CategoryRecord`/`WeeklyStat` rows
currently attributed to Inktest's `memberId` for the same weeks - if
they're there, that's the corrupted data. The fix from that point is
manual and specific to what you find (create a real `minktest` Member row,
then re-point just those specific weeks' `CategoryRecord`/`WeeklyStat` rows
from Inktest's `memberId` to the new one) - I'd rather you (or whoever runs
this) look at the actual rows before anything gets updated than have me
hand you an UPDATE statement against production data I can't see.

---

# Part C: add a plain Rename option next to Merge

Sometimes there's only one real person and the name is just wrong (a
misread), not two rows to combine. Renaming `Member.name` directly already
updates every report/dashboard automatically - they all join on `memberId`,
never on the name string - so this is much simpler than a merge. The one
thing worth doing alongside it: keep the old name as a recognized alias, so
a future screenshot that's still read with the old (wrong) spelling
continues to match this member instead of creating a duplicate all over
again.

## `app/api/users/[id]/route.ts` — accept a `name` field

Add this handling inside the existing `PATCH` handler, alongside the other
`body.*` checks (this is written against the version of the file from
before the login-alias spec - if that's already applied, merge this into
its version of the same handler rather than reverting it):

```ts
if (typeof body.name === "string") {
  const newName = body.name.trim();
  if (!newName) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }
  if (newName !== current.name) {
    const existingAliases = current.aliases
      ? current.aliases.split(",").map((a) => a.trim()).filter(Boolean)
      : [];
    if (!existingAliases.some((a) => a.toLowerCase() === current.name.toLowerCase())) {
      existingAliases.push(current.name);
    }
    data.name = newName;
    data.aliases = existingAliases.join(",");
  }
}
```

And wrap the final `prisma.member.update(...)` call in a try/catch for the
unique-name collision (skip this if you've already added an equivalent
P2002 handler from another spec on this same route):

```ts
try {
  const updated = await prisma.member.update({ where: { id: memberId }, data });
  return NextResponse.json({ ok: true, id: updated.id });
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return NextResponse.json({ error: "Another member already has that name." }, { status: 400 });
  }
  throw err;
}
```

(Needs `import { Prisma } from "@/lib/generated/prisma/client";` at the top
if it's not already there from another spec.)

## `app/setup/users/merge/MergeClient.tsx` — new "Rename" section

Add alongside the existing state declarations:

```ts
const [renameId, setRenameId] = useState<number | "">("");
const [newName, setNewName] = useState("");
const [renaming, setRenaming] = useState(false);
const [renameError, setRenameError] = useState<string | null>(null);
const [renameResult, setRenameResult] = useState<string | null>(null);

async function handleRename() {
  if (renameId === "" || !newName.trim()) return;
  const oldName = sorted.find((u) => u.id === renameId)?.name;
  const proceed = confirm(
    `Rename "${oldName}" to "${newName.trim()}"? Every report and historical record for this member updates ` +
      `automatically (they're linked by member ID, not name) - "${oldName}" is kept as a recognized alias so a ` +
      `screenshot still read with the old spelling keeps matching this member instead of creating a duplicate.`
  );
  if (!proceed) return;

  setRenaming(true);
  setRenameError(null);
  setRenameResult(null);
  const res = await fetch(`/api/users/${renameId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName.trim() }),
  });
  const data = await res.json();
  setRenaming(false);
  if (!res.ok) {
    setRenameError(data.error ?? "Rename failed.");
    return;
  }
  setRenameResult(`Renamed "${oldName}" to "${newName.trim()}".`);
  setRenameId("");
  setNewName("");
  await load();
}
```

New section in the JSX, below the existing Merge card (reuses the same
recently-active/rest `<optgroup>` split from `merge-list-recent-split-
spec.md` - if that hasn't shipped yet, use a flat `sorted.map(...)` here
instead and revisit once it has):

```tsx
<div className="border border-neutral-200 rounded max-w-lg p-4 flex flex-col gap-3">
  <div>
    <h2 className="font-medium">Rename a member</h2>
    <p className="text-neutral-500 text-sm mt-1">
      For one real person whose name was just misread - not two rows to combine. Updates every report and
      historical record automatically.
    </p>
  </div>

  <div className="flex flex-col gap-1 text-sm">
    <label className="font-medium">Member</label>
    <select
      value={renameId}
      onChange={(e) => setRenameId(e.target.value ? Number(e.target.value) : "")}
      className="border border-neutral-300 rounded px-2 py-1.5 w-full"
    >
      <option value="">Select…</option>
      {recent.length > 0 && (
        <optgroup label="Active in the last 3 weeks">
          {recent.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label="Everyone else">
          {rest.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  </div>

  <div className="flex flex-col gap-1 text-sm">
    <label className="font-medium">New name</label>
    <input
      type="text"
      value={newName}
      onChange={(e) => setNewName(e.target.value)}
      className="border border-neutral-300 rounded px-2 py-1.5 w-full"
    />
  </div>

  <button
    onClick={handleRename}
    disabled={renaming || renameId === "" || !newName.trim()}
    className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50 self-start"
  >
    {renaming ? "Renaming…" : "Rename"}
  </button>

  {renameError && <p className="text-red-600 text-sm">{renameError}</p>}
  {renameResult && <p className="text-green-700 text-sm">{renameResult}</p>}
</div>
```

---

# Part D: "confirmed" but still greyed out - two unrelated signals wearing the same color

## Diagnosis

Confirming a name (`nameConfirmed: true`) and the row's grey/dim styling
are completely unrelated. The dimming (`UsersClient.tsx`, the `<tr
className={... ${u.isActive ? "" : "opacity-50"}}>` on the row) is driven
entirely by `isActive`, which `syncMemberActiveStatus()`
(`lib/members/activeSync.ts`) computes from "had data in the *last
completed* week" - deliberately excluding the most recent week, since it's
still being imported. A member who was just auto-created *this* week has,
by definition, no data in any completed week yet - so they show as
`isActive: false` (dimmed) regardless of whether you've confirmed their
name. Confirming removes the amber "New" badge correctly; it was never
going to change the dimming, because the dimming isn't about confirmation
at all. That's not a bug in the sense of doing the wrong thing - it's two
independent signals that happen to look like the same thing, which is
exactly what's confusing here.

### Fix: distinguish "too new to judge" from "actually inactive"

`app/api/users/route.ts` — add a set of members who've *ever* had a
completed week of data (not just the recent-3-week window from the merge-
list spec - this is "any history at all"):

```ts
const [statMembersEver, recordMembersEver] =
  lastCompletedWeek !== null
    ? await Promise.all([
        prisma.weeklyStat.findMany({
          where: { weekNumber: { lte: lastCompletedWeek } },
          select: { memberId: true },
          distinct: ["memberId"],
        }),
        prisma.categoryRecord.findMany({
          where: { weekNumber: { lte: lastCompletedWeek } },
          select: { memberId: true },
          distinct: ["memberId"],
        }),
      ])
    : [[], []];
const everHadCompletedWeekIds = new Set([
  ...statMembersEver.map((s) => s.memberId),
  ...recordMembersEver.map((r) => r.memberId),
]);
```

Add `everHadCompletedWeek: everHadCompletedWeekIds.has(m.id)` to each
mapped user in the response (alongside `recentlyActive`/`loginAlias` from
the other specs, if those have landed - all three are independent added
fields on the same object).

`app/setup/users/list/UsersClient.tsx` — add `everHadCompletedWeek:
boolean` to the `User` type, then:

Row dimming (only dim a member who's actually gone quiet, not one who
simply hasn't had a completed week yet):

```tsx
<tr key={u.id} className={`border-b border-neutral-100 ${!u.isActive && u.everHadCompletedWeek ? "opacity-50" : ""}`}>
```

Active/Inactive badge cell - add the third "New" state so it's not just
silently un-dimmed with no explanation:

```tsx
{u.effectiveRole === "MEMBER" ? (
  u.isActive ? (
    <span
      title="Auto-managed from last completed week's stats"
      className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800"
    >
      Active
    </span>
  ) : u.everHadCompletedWeek ? (
    <span
      title="Auto-managed from last completed week's stats"
      className="text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-500"
    >
      Inactive
    </span>
  ) : (
    <span
      title="No completed week of stats yet - too new to judge"
      className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800"
    >
      New
    </span>
  )
) : (
  // unchanged - Admin/Leader manual toggle
)}
```

## Bump the version number

`lib/version.ts` — increment `MINOR` by 1 from whatever it currently is at
implementation time (once, covering all four parts, if implemented together).

## Test plan

1. Confirm/reject a "New" member; the table should not flash to "Loading…"
   and your scroll position should not move.
2. Manually create two members whose normalized names differ by one
   character and are short (e.g. "Neo"/"Leo") and confirm a matching
   screenshot no longer silently combines them - it should create a
   separate "New" row instead.
3. Run the `RawExtraction` query above for "minktest" and report back what
   it shows before anything gets manually corrected.
4. Rename a member; confirm dashboards/reports for them still show
   correctly under the new name, and that the old name is now listed in
   their aliases (Setup → Categories or wherever aliases are visible/
   editable, or just check the DB column directly).
5. Find a member auto-created this week (not yet in a completed week);
   confirm they now show a "New" badge in the Active column and are not
   row-dimmed, instead of reading as "Inactive."
