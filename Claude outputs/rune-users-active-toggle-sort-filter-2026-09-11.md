# RUNE — Setup → Users: manual Active toggle for members, plus sortable/filterable headers

Confirmed live version is `v02.0039`. This spec targets `v02.0040`.

## Before you build this

**The Active toggle needs a real design decision, not just a UI swap.** Read the live
`lib/members/activeSync.ts` first — for a `MEMBER`-role row, `isActive` is currently
*entirely* auto-computed: `syncMemberActiveStatus()` runs on every single `/api/users` load
and unconditionally recomputes `isActive` from the last two completed weeks' stats for every
member whose effective role is `MEMBER`. If the label were simply swapped for a toggle
without anything else changing, clicking it would appear to work, then silently revert the
next time the page reloads (which is immediately, since the click's own follow-up `load()`
call re-triggers the same sync) - a genuinely confusing, broken-looking feature.

The fix mirrors a pattern already in this exact codebase: `Member.role` is a nullable manual
override that wins over the auto-derived value (`effectiveRole()` in `lib/auth/roles.ts`) -
null means "auto," non-null means "an admin decided." This spec adds the same shape for
`isActive`: a new nullable `Member.activeOverride` column. Null (the default, including for
every existing row) means keep auto-managing it exactly as today; setting it (via the new
toggle) means "an admin decided this, leave it alone" - `syncMemberActiveStatus()` skips any
member with a non-null override entirely.

One thing this does NOT include unless you want it: once a member is manually overridden,
there's currently no UI path back to "auto-managed" *except* the small "reset to auto" link
this spec does add next to the toggle for exactly that reason - it seemed wrong to build a
one-way trapdoor (manually mark someone Active once, and they're permanently exempt from ever
being flagged Inactive again even after they've clearly stopped playing) without giving you a
way out of it. If that's more than you wanted, it's a two-line removal in Change 4.

Admin/Leader rows are already fully manual today (`syncMemberActiveStatus()` never touches
them) - this spec still writes `activeOverride` for them too when their toggle is clicked,
purely so the column has one consistent meaning across every row and so the override "sticks"
correctly if a role later changes to Member. It has no functional effect for them today.

## Change 1 — schema: `prisma/schema.prisma`

Add `activeOverride` to `Member`, right after `isActive`:

```prisma
  isActive     Boolean @default(true)
  // Manual override for isActive - null (default, every existing row) means auto-managed by
  // syncMemberActiveStatus() exactly as before this field existed; true/false means an admin
  // explicitly set it via Setup -> Users' Active toggle, and sync now skips this member
  // entirely until it's reset back to null ("reset to auto" on that same screen). Mirrors the
  // existing Member.role override pattern (see lib/auth/roles.ts). Admin/Leader rows are
  // never auto-managed regardless of this value - see syncMemberActiveStatus().
  activeOverride Boolean?
  theme        String  @default("default")
```

Run `npx prisma db push && npx prisma generate` (no migrations folder in this project - see
the project memory file). Every existing row gets `activeOverride: null` automatically, which
is exactly "no change in behavior" for the whole current roster.

## Change 2 — `lib/members/activeSync.ts`: skip overridden members

Add `activeOverride: true` to the `select` in the `prisma.member.findMany(...)` call:

```ts
  const members = await prisma.member.findMany({
    select: { id: true, role: true, allianceRank: true, isActive: true, activeOverride: true },
  });
```

Add one line to the loop, right after the existing role check:

```ts
  for (const m of members) {
    if (effectiveRole(m) !== "MEMBER") continue;
    if (m.activeOverride !== null) continue; // manually set via Setup -> Users - leave alone until reset to auto
    if (!everHadHistory.has(m.id)) continue;
    const shouldBeActive = activeIds.has(m.id);
    if (m.isActive === shouldBeActive) continue;
    (shouldBeActive ? toActivate : toDeactivate).push(m.id);
  }
```

## Change 3 — `app/api/users/[id]/route.ts`: accept the toggle and the reset

Add `activeOverride?: null` to the request body type (it's only ever sent as `null` - the
"reset to auto" action; setting an override to a real value happens implicitly whenever
`isActive` itself is set, see below) and `activeOverride?: boolean | null` to `data`:

```ts
  const body = (await request.json()) as {
    password?: string;
    role?: string | null;
    isActive?: boolean;
    activeOverride?: null;
    nameConfirmed?: boolean;
    loginAlias?: string | null;
    name?: string;
    addAlias?: string;
    removeAlias?: string;
  };
  const data: {
    passwordHash?: string;
    role?: string | null;
    isActive?: boolean;
    activeOverride?: boolean | null;
    nameConfirmed?: boolean;
    loginAlias?: string | null;
    name?: string;
    aliases?: string;
  } = {};
```

Replace the existing `isActive` handling:

```ts
  if (body.isActive !== undefined) {
    data.isActive = body.isActive;
    // Any explicit isActive write (from this toggle, for any role) is a manual decision -
    // record it so syncMemberActiveStatus() stops recomputing this member. See Change 1/2.
    data.activeOverride = body.isActive;
  }

  if (body.activeOverride === null) {
    // "Reset to auto" - isActive itself is left exactly as it is right now; the very next
    // sync run corrects it if needed, which happens immediately since GET /api/users calls
    // syncMemberActiveStatus() before it reads any member back out.
    data.activeOverride = null;
  }
```

Nothing else in this file changes - the "last active admin" guardrail still reads
`body.isActive` the same way it already did.

## Change 4 — `app/setup/users/list/UsersClient.tsx`

### The toggle itself - replace the whole Active `<td>`

```tsx
type User = {
  id: number;
  name: string;
  allianceRank: string | null;
  roleOverride: Role | null;
  effectiveRole: Role;
  hasPassword: boolean;
  isActive: boolean;
  activeOverride: boolean | null;
  nameConfirmed: boolean;
  loginAlias: string | null;
  everHadCompletedWeek: boolean;
  canLogIn: boolean;
};
```

Replace the entire existing Active `<td>` (the one with the `u.effectiveRole === "MEMBER" ?
(...) : (toggle)` branch) with a single toggle for every row, plus a small status/reset
caption for `MEMBER` rows only (Admin/Leader rows show nothing extra - they were already
plain manual, nothing to explain):

```tsx
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => patchUser(u.id, { isActive: !u.isActive })}
                        disabled={busyId === u.id}
                        className={`w-9 h-5 rounded-full relative transition-colors ${u.isActive ? "bg-green-500" : "bg-neutral-300"}`}
                        aria-label="Toggle active"
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${u.isActive ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                      {u.effectiveRole === "MEMBER" &&
                        (u.activeOverride !== null ? (
                          <button
                            onClick={() => patchUser(u.id, { activeOverride: null })}
                            disabled={busyId === u.id}
                            className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                            title="Manually set - click to hand this back to automatic weekly-stat tracking"
                          >
                            manual · reset to auto
                          </button>
                        ) : (
                          <span
                            className="text-xs text-neutral-400"
                            title="Auto-managed from last completed week's stats"
                          >
                            {u.everHadCompletedWeek ? "auto" : "new"}
                          </span>
                        ))}
                    </div>
                  </td>
```

Update `patchUser`'s local optimistic-update block so the caption/reset-link switches state
immediately, without waiting for a reload:

```ts
          if ("isActive" in body) {
            updated.isActive = body.isActive as boolean;
            updated.activeOverride = body.isActive as boolean; // server sets these together - see the PATCH route
          }
          if ("activeOverride" in body) updated.activeOverride = body.activeOverride as boolean | null;
```

(Goes in the same `setUsers((prev) => prev.map((u) => { ... }))` block that already handles
`nameConfirmed`/`isActive`/`role`/`loginAlias` - add these two lines alongside the existing
`if ("isActive" in body) updated.isActive = ...` line, replacing it.)

### Sortable, filterable headers

Add state, right after the existing `filter` state:

```ts
  type SortKey = "name" | "allianceRank" | "role" | "active";
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [rankFilter, setRankFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<"" | "active" | "inactive" | "new">("");
```

Replace the existing `const filtered = users.filter(...)` line with the fuller pipeline
(filter, then sort) - `distinctRanks` feeds the Rank filter's options:

```ts
  const distinctRanks = [...new Set(users.map((u) => u.allianceRank).filter((r): r is string => !!r))].sort();

  function isNew(u: User): boolean {
    return u.effectiveRole === "MEMBER" && !u.everHadCompletedWeek;
  }

  const filtered = users
    .filter((u) => u.name.toLowerCase().includes(filter.toLowerCase()))
    .filter((u) => !roleFilter || u.effectiveRole === roleFilter)
    .filter((u) => !rankFilter || u.allianceRank === rankFilter)
    .filter((u) => {
      if (!activeFilter) return true;
      if (activeFilter === "new") return isNew(u);
      if (activeFilter === "active") return u.isActive;
      return !u.isActive && !isNew(u); // "Inactive" excludes "New" - matches the 3-way meaning the caption already uses
    });

  function sortValue(u: User): string | number {
    switch (sortKey) {
      case "name":
        return u.name.toLowerCase();
      case "allianceRank":
        return u.allianceRank ?? "";
      case "role":
        return u.effectiveRole;
      case "active":
        return u.isActive ? 1 : 0;
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="ml-1 text-neutral-400">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }
```

Replace the `<thead>` (one clickable label row, one filter row underneath - Login/Alias get
neither, since Login is a derived multi-part status and Alias is a free-text draft field,
not naturally sortable/filterable):

```tsx
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  Name{sortArrow("name")}
                </th>
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("allianceRank")}>
                  Rank{sortArrow("allianceRank")}
                </th>
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("role")}>
                  Role{sortArrow("role")}
                </th>
                <th className="py-2 pr-3">Login</th>
                <th className="py-2 pr-3">Alias</th>
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("active")}>
                  Active{sortArrow("active")}
                </th>
              </tr>
              <tr className="border-b border-neutral-200 text-left">
                <th className="py-1 pr-3 font-normal" />
                <th className="py-1 pr-3 font-normal">
                  <select
                    value={rankFilter}
                    onChange={(e) => setRankFilter(e.target.value)}
                    className="border border-neutral-300 rounded px-1.5 py-1 text-xs w-full"
                  >
                    <option value="">All ranks</option>
                    {distinctRanks.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="py-1 pr-3 font-normal">
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as Role | "")}
                    className="border border-neutral-300 rounded px-1.5 py-1 text-xs w-full"
                  >
                    <option value="">All roles</option>
                    <option value="ADMIN">Admin</option>
                    <option value="LEADER">Leader</option>
                    <option value="MEMBER">Member</option>
                  </select>
                </th>
                <th className="py-1 pr-3 font-normal" />
                <th className="py-1 pr-3 font-normal" />
                <th className="py-1 pr-3 font-normal">
                  <select
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
                    className="border border-neutral-300 rounded px-1.5 py-1 text-xs w-full"
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="new">New</option>
                  </select>
                </th>
              </tr>
            </thead>
```

Finally, change the `<tbody>` to map over `sorted` instead of `filtered`:

```tsx
            <tbody>
              {sorted.map((u) => (
```

(Just the one word - everything inside each row stays exactly as it is, including the Active
`<td>` replaced above.)

## Bump the version

`lib/version.ts`:

```ts
const MINOR = 40;
```

## Test

1. `npx prisma db push && npx prisma generate`, then deploy. Confirm the header version.
2. Open Setup → Users. Confirm every row - Member included - now shows a toggle switch where
   the plain "Active"/"Inactive"/"New" label used to be, and confirm a `MEMBER` row also shows
   a small "auto" or "new" caption next to it.
3. Click a `MEMBER` row's toggle. Confirm it flips immediately, and the caption changes to
   "manual · reset to auto".
4. Reload the page. Confirm the toggle stays exactly where you left it - this is the actual
   bug the override column exists to prevent; a reversion here means the sync skip in Change 2
   isn't wired up correctly.
5. Click "reset to auto" on that same member. Confirm the caption goes back to "auto" (or
   "new"), and that `isActive` settles to whatever the real weekly-stat-based value should be
   on the very next load.
6. Click Name/Rank/Role/Active headers - confirm each sorts the table, and clicking the same
   header again reverses the direction (arrow flips too). Confirm Login/Alias headers aren't
   clickable (no cursor change, no sort).
7. Use the Rank and Role filter dropdowns together with the existing name search box - confirm
   they combine (AND, not OR) rather than one overriding the other. Set the Active filter to
   each of Active/Inactive/New in turn and confirm the results match what the caption/toggle
   on each visible row would suggest.
8. Confirm Admin/Leader rows still behave exactly as before - toggle still works the same way
   it always did, no new caption appears next to their toggle.
