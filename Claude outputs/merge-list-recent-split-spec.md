# Split the Merge page's member lists: recently active first

For the Claude Code session on Frans's machine.

## What's there today

`app/setup/users/merge/MergeClient.tsx` fetches the full member list from
`GET /api/users` and renders it as one flat alphabetical `<select>` for
both "Keep" and "Merge away" — every member who ever existed, in one list,
which gets unwieldy once there's real history. There's already a reusable
building block for "who had data for week N": `getActiveMemberIdsForWeek()`
in `lib/members/weekActivity.ts` (checks both `WeeklyStat` and
`CategoryRecord`), and `syncMemberActiveStatus()` in
`lib/members/activeSync.ts` already establishes "last completed week" as
`(latest week with any data) - 1` — the same anchor used for the `isActive`
badge elsewhere. This reuses both rather than inventing a new definition of
"recent."

## 1. `app/api/users/route.ts` — compute a `recentlyActive` flag per member

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/auth/roles";
import { syncMemberActiveStatus } from "@/lib/members/activeSync";
import { getActiveMemberIdsForWeek } from "@/lib/members/weekActivity";

const RECENT_WEEKS = 3;

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { lastCompletedWeek } = await syncMemberActiveStatus();

  // "Recently active" = had a WeeklyStat/CategoryRecord row in any of the last 3 completed
  // weeks (same completed-week anchor as isActive, just a wider window) - used to split the
  // Merge page's member pickers so a genuine same-person duplicate (someone active right
  // now under two spellings) sorts to the top instead of getting lost among everyone who's
  // ever passed through the alliance.
  let recentlyActiveIds = new Set<number>();
  if (lastCompletedWeek !== null) {
    const weekSets = await Promise.all(
      Array.from({ length: RECENT_WEEKS }, (_, i) => lastCompletedWeek - i)
        .filter((w) => w >= 1)
        .map((w) => getActiveMemberIdsForWeek(w))
    );
    recentlyActiveIds = new Set(weekSets.flatMap((s) => [...s]));
  }

  const members = await prisma.member.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({
    lastCompletedWeek,
    users: members.map((m) => ({
      id: m.id,
      name: m.name,
      allianceRank: m.allianceRank,
      roleOverride: m.role,
      effectiveRole: effectiveRole(m),
      hasPassword: !!m.passwordHash,
      isActive: m.isActive,
      nameConfirmed: m.nameConfirmed,
      recentlyActive: recentlyActiveIds.has(m.id),
    })),
  });
}
```

(`requireAdminApi` import stays as-is at the top of the file - only the
body changed here. If the login-alias spec has already been applied to
this file by the time you implement this, keep its `loginAlias` line in
the returned object too - just add `recentlyActive` alongside it.)

## 2. `app/setup/users/merge/MergeClient.tsx` — split both pickers into two groups

Update the `User` type (line 6) and add the split just above the return:

```ts
type User = { id: number; name: string; recentlyActive: boolean };
```

```ts
const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name));
const recent = sorted.filter((u) => u.recentlyActive);
const rest = sorted.filter((u) => !u.recentlyActive);
```

Replace both `<select>` bodies (currently a single flat `.map()` each) with
grouped `<optgroup>`s - native to `<select>`, no new UI component needed.
"Keep" picker:

```tsx
<select
  value={keepId}
  onChange={(e) => setKeepId(e.target.value ? Number(e.target.value) : "")}
  className="border border-neutral-300 rounded px-2 py-1.5 w-full"
>
  <option value="">Select…</option>
  {recent.length > 0 && (
    <optgroup label="Active in the last 3 weeks">
      {recent.map((u) => (
        <option key={u.id} value={u.id} disabled={u.id === mergeId}>
          {u.name}
        </option>
      ))}
    </optgroup>
  )}
  {rest.length > 0 && (
    <optgroup label="Everyone else">
      {rest.map((u) => (
        <option key={u.id} value={u.id} disabled={u.id === mergeId}>
          {u.name}
        </option>
      ))}
    </optgroup>
  )}
</select>
```

"Merge away" picker — identical structure, just swap which id it disables
against (matches the existing pattern of the two selects only differing in
that one prop):

```tsx
<select
  value={mergeId}
  onChange={(e) => setMergeId(e.target.value ? Number(e.target.value) : "")}
  className="border border-neutral-300 rounded px-2 py-1.5 w-full"
>
  <option value="">Select…</option>
  {recent.length > 0 && (
    <optgroup label="Active in the last 3 weeks">
      {recent.map((u) => (
        <option key={u.id} value={u.id} disabled={u.id === keepId}>
          {u.name}
        </option>
      ))}
    </optgroup>
  )}
  {rest.length > 0 && (
    <optgroup label="Everyone else">
      {rest.map((u) => (
        <option key={u.id} value={u.id} disabled={u.id === keepId}>
          {u.name}
        </option>
      ))}
    </optgroup>
  )}
</select>
```

No other lines in this file need to change - `handleMerge()`,
`sorted.find(...)` for the confirm dialog, etc. all still work against the
same flat `users`/`sorted` arrays.

## Bump the version number

`lib/version.ts` — increment `MINOR` by 1 from whatever it currently is at
implementation time.

## Test plan

1. Open Setup → Users → Merge. Confirm each dropdown now shows two labeled
   groups instead of one flat list, with members active in the last 3
   completed weeks listed first.
2. If nobody's been imported yet for any recent week, confirm the page
   doesn't break - it should just show "Everyone else" with no empty first
   group (both `<optgroup>`s are conditionally rendered).
3. Merge still works exactly as before - the split only changes how the
   two lists are grouped for picking, not the merge logic itself.
