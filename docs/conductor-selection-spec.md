# Conductor Selection — Design Spec

**Module:** Rotation & Selection
**Source of truth today:** `Conductor.xlsx` (sheets `Data`, `Rules`, `Assignments`, `Historic`)
**Status:** Draft v1 for review

---

## 1. Purpose

Replace the spreadsheet-driven Conductor rotation with an app function that:

1. Converts raw weekly event scores into **participation points** using configurable rates.
2. Maintains a **running balance** per member that carries across weeks.
3. On demand, selects the **top N members by balance** for a rotation cycle, where N is driven by a chosen cycle length (1 week → 7, 2 weeks → 14).
4. **Zeroes the balance** of every selected member so they re-accumulate from zero.
5. Persists the selection as **history** — which does not exist today and is the main gap this spec closes.

All scoring rates, cycle length, and eligibility rules live on a **separate Setup tab**, not inline with the roster.

---

## 2. What exists today (derived from the workbook)

| Sheet | Rows | Role |
|---|---|---|
| `Data` | 1,268 data rows, 113 members, weeks 51–63 | Raw weekly submission per member per week |
| `Rules` | 9 | Conversion rates + season start week (51) |
| `Assignments` | working sheet | Current-cycle top 14, daily C:/V: roster, event-winner lookups |
| `Historic` | 91 | 7 selections per week × 13 weeks, with points at time of selection |

**Observed mechanics to preserve:**

- Per-week points = `VS + DS + Kills + AL + ZS + Donate + Squads`, each converted from a raw score by a divisor on `Rules`.
- `Kills` uses a **delta**: current cumulative `TotalKills` minus the member's previous max, so a member's first-ever week scores 0 kills.
- `Squads` is a **flat bonus** if any of Air / Tank / Missile / T4 was submitted — it is a participation flag, not a magnitude.
- Balance = `SUM(weekly subtotals) + SUM(adjustments)`, where selection writes a **negative adjustment equal to the balance at that moment**. Verified: `Historic` week 52 Marcin4 = 208.7606 matches an `Assigned` value of −208.7606.
- Weeks before `Rules!E1` (start week 51) score zero — a season boundary.
- Historically **7 selections per week**, and members do repeat (Inktest 5×, several at 3×) — so there is no permanent lockout.

**Known defects to fix in the app:**

- Week 56 has only 6 adjustments for 7 selections. The reset is attached to a submission row, so a member selected in a week they didn't submit **cannot be zeroed** and silently keeps their balance.
- `Historic` stores a name string with inconsistent casing (`lupu67` / `Lupu67`, `OmarinhoZ` / `Omarinhoz`) and no member ID, so repeat-count and cooldown logic is unreliable.
- The VIP column on `Historic` is populated for only 41 of 91 rows.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Member** | A roster entry with a stable ID; display name may change |
| **Week** | Game week number (integer, e.g. 63). Also the submission grain |
| **Event score** | Raw submitted value: VS Score, DS Points, TotalKills, Donations, squad flags |
| **Weekly points** | Event scores converted to points for one member-week |
| **Balance** | Running points a member carries: earned − reset |
| **Cycle** | The rotation period being filled: 1 or 2 weeks |
| **Slot** | One day of the cycle needing one Conductor (7 slots/week) |
| **Selection** | A confirmed, immutable record of one member filling one slot |
| **Reset** | The negative adjustment written when a member is selected |

---

## 4. Data model

Ledger-based. Balances are **never stored as a mutable number** — they are always derived, so any selection can be audited or replayed.

### 4.1 `members`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `display_name` | text | |
| `normalized_name` | text, unique | lowercased, trimmed — for import matching |
| `status` | enum | `active`, `inactive`, `excluded` |
| `joined_week` | int | |
| `hq_level`, `power`, `rank` | int/num | latest snapshot, display only |

### 4.2 `weekly_scores` — raw submissions (already exists)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | fk | |
| `week` | int | unique with `member_id` |
| `vs_score`, `ds_points`, `donations`, `total_kills` | numeric | as submitted |
| `zombie_score`, `alliance_ex_score` | numeric | nullable |
| `air`, `tank`, `missile`, `t4` | numeric | squad submission values |
| `imported_at`, `source` | | |

### 4.3 `points_ledger` — the core append-only table
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | fk | |
| `week` | int | week the entry is attributed to |
| `entry_type` | enum | `earned`, `reset`, `manual_adjustment` |
| `amount` | numeric(12,5) | positive for `earned`, negative for `reset` |
| `breakdown` | jsonb | `{vs, ds, kills, donate, squads, zombie, alliance}` for `earned` |
| `selection_id` | fk nullable | set on `reset` |
| `rule_version_id` | fk | which rate set produced this |
| `note`, `created_by`, `created_at` | | |

> **Balance** = `SUM(amount) WHERE member_id = ?`. A `reset` is a ledger row, **not** a column on a submission row — this fixes the week-56 defect: a member with no submission that week still gets zeroed correctly.

### 4.4 `selection_rounds` — the missing history
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | e.g. "Weeks 64–65" |
| `weeks_in_cycle` | int | 1 or 2 |
| `slot_count` | int | `weeks_in_cycle × slots_per_week` |
| `start_week`, `start_date` | | |
| `status` | enum | `draft`, `confirmed`, `voided` |
| `rule_version_id` | fk | rates in force when generated |
| `generated_at`, `confirmed_at`, `confirmed_by` | | |

### 4.5 `selections`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `round_id` | fk | |
| `member_id` | fk | |
| `position` | int | 1..N, rank order at selection time |
| `slot_index` | int | 0..N−1 |
| `slot_date` | date | the day this member is Conductor |
| `role` | enum | `conductor` (see §10 for `vip`) |
| `points_at_selection` | numeric | frozen snapshot — the `Historic` "Points" column |
| `was_manual_override` | bool | |
| `override_reason` | text nullable | |

Unique: (`round_id`, `slot_index`). Unique: (`round_id`, `member_id`, `role`).

### 4.6 `rule_versions` + `scoring_rules` — Setup tab data
| Field | Type | Notes |
|---|---|---|
| `rule_versions.id` | uuid PK | |
| `effective_from_week` | int | |
| `is_active` | bool | one active version at a time |
| `scoring_rules.metric` | enum | `vs`, `ds`, `kills`, `donations`, `zombie`, `alliance_ex`, `squads` |
| `points_per_unit` | numeric | numerator, e.g. 1 |
| `unit_size` | numeric | divisor, e.g. 1,000,000 |
| `mode` | enum | `rate` or `flat_bonus` |
| `flat_value` | numeric | for `squads` = 20 |
| `enabled` | bool | zombie/alliance are currently 0 — disabled |

Versioning matters: changing a rate must not silently rewrite past selections. Editing rates creates a **new version**; historical ledger rows keep their original `rule_version_id`.

---

## 5. Points engine

### 5.1 Per member-week calculation

```
if week < season_start_week: weekly_points = 0

kills_delta = max(0, total_kills − max(total_kills of that member in any week < this week))
              // if no prior week exists → 0

vs      = vs_score × vs_multiplier / vs_unit          // multiplier 1000 in current sheet
ds      = ds_points / ds_unit
kills   = kills_delta / kills_unit
donate  = donations / donate_unit
zombie  = zombie_score / zombie_unit                  // if rule enabled
alliance= alliance_score / alliance_unit              // if rule enabled
squads  = squads_flat if (air + tank + missile + t4) > 0 else 0

weekly_points = vs + ds + kills + donate + zombie + alliance + squads
```

Current active rates (from `Rules`), to be seeded into Setup:

| Metric | Rule | Mode |
|---|---|---|
| VS | 1 pt per 1,000,000 (score × 1,000) | rate |
| DS | 1 pt per 100,000 | rate |
| Donations | 1 pt per 1,200 | rate |
| Kills | 1 pt per 25,000 (delta) | rate |
| Squads | 20 pts if submitted | flat bonus |
| Zombie | disabled (rate 0) | rate |
| Alliance Ex | disabled (rate 0) | rate |

> **Assumption to confirm:** the `× 1000` on VS is a unit correction (score submitted in thousands). It should be modelled as an explicit `input_multiplier` field on the rule, not hardcoded.

### 5.2 Recalculation

- Importing or editing a week **upserts** the `earned` ledger row for each affected member-week. It never touches `reset` rows.
- Editing week W's raw kills also invalidates week W+1's kills delta for that member — recalculate the member's chain from W forward.
- Recalculation is blocked for weeks belonging to a `confirmed` round unless an admin explicitly chooses **Recalculate & re-open**, which flags affected rounds for review rather than silently changing history.

### 5.3 Rounding

Store 5 decimal places, round half-up. Display 2. Rank on the stored value, not the displayed one — current data has ties that only appear at display precision.

---

## 6. Selection function (core deliverable)

### 6.1 Inputs

| Input | Source | Default |
|---|---|---|
| `weeks_in_cycle` | user picks on the selection screen | Setup default |
| `slots_per_week` | Setup | 7 |
| `start_date` | user | next Monday |
| eligibility rules | Setup | see §7.2 |

`slot_count = weeks_in_cycle × slots_per_week` — **1 week = top 7, 2 weeks = top 14.**

### 6.2 Algorithm

```
1. balances → for each active member: SUM(points_ledger.amount)
2. pool     → balances filtered by eligibility rules (§7.2)
3. rank     → sort pool by balance DESC, then tiebreakers (§6.3)
4. if len(pool) < slot_count → warn, fill what is possible, flag shortfall
5. picked   → rank[0 : slot_count]
6. create selection_round(status = draft)
   for i, member in enumerate(picked):
       create selection(position = i+1,
                        slot_index = i,
                        slot_date = start_date + i days,
                        points_at_selection = member.balance)
7. present draft for review; allow reorder / swap / exclude, then re-fill from rank
8. on CONFIRM (single transaction):
       for each selection:
           insert points_ledger(entry_type = 'reset',
                                amount = −points_at_selection,
                                week = current_week,
                                selection_id = selection.id)
       round.status = 'confirmed'
```

**The reset amount is the frozen `points_at_selection`, not a re-read of the balance at confirm time.** If a week is imported between generating the draft and confirming it, re-reading would zero out points the member earned after the ranking was taken. The confirm step should warn if any balance has moved since generation and offer to regenerate.

### 6.3 Tiebreakers (in order)

1. Higher balance
2. Fewer total prior selections (all time)
3. Longer since last selection (earlier `last_selected_week`, nulls first)
4. Higher current-week points
5. Alphabetical by normalized name — deterministic, so a regenerated draft is reproducible

### 6.4 Slot ordering

Default: position 1 takes day 1 of the cycle. Configurable in Setup to `reverse` (highest scorer gets the final day) or `manual`. Days are calendar days from `start_date`; the current sheet labels them Monday – Sunday per week.

---

## 7. Setup tab

A **separate top-level tab**, admin-only. Changes are audited (`who`, `when`, `before` → `after`). Sections:

### 7.1 Scoring rules
Editable grid: Metric | Enabled | Input multiplier | Points | per | Unit | Mode. Mirrors the `Rules` sheet layout so it is familiar. A **live preview** panel shows what last week's top 5 would score under the edited rates before saving, and saving prompts: *apply going forward* (new version, default) or *apply from week X* (triggers recalculation).

### 7.2 Selection rules
| Setting | Type | Default |
|---|---|---|
| Slots per week | int | 7 |
| Default cycle length | 1 or 2 weeks | 2 |
| Season start week | int | 51 |
| Minimum balance to be eligible | numeric | 0 |
| Minimum weeks of submitted data | int | 1 |
| Cooldown — weeks before re-selection | int | 0 (matches current behaviour) |
| Exclude members with no submission in last N weeks | int | 2 |
| Exclude currently-serving members | bool | true |
| Slot ordering | enum | rank ascending |
| Tiebreaker order | drag-to-reorder | as §6.3 |

### 7.3 Roster management
Member list with status toggle, permanent exclusion, name-alias mapping (so `Lupu67` and `lupu67` resolve to one ID), and manual point adjustment with a mandatory reason.

### 7.4 Import
Column mapping for the raw source, week-number detection, duplicate handling (`member_id` + `week` upsert), and a dry-run diff before commit.

### 7.5 History maintenance
Backfill tool for weeks 51–63: import `Historic` (week, name, points) into `selection_rounds` / `selections` as 13 single-week rounds of 7, marked `backfilled = true`. Unmatched names are surfaced for manual mapping rather than auto-created.

---

## 8. Screens

**Tab 1 — Standings.** Sortable table: Rank | Member | Balance | Current week points | Weeks since last selected | Times selected. Row expands to a per-week breakdown by metric. Filter by week range; export CSV.

**Tab 2 — Selection.** Cycle-length toggle (1 week / 2 weeks, showing "→ 7 slots" / "→ 14 slots"), start-date picker, **Generate draft** button. Draft view lists positions 1..N with member, points, day, and an ineligibility reason for anyone skipped. Each row has swap and exclude actions. A footer states plainly: *"Confirming will zero 14 members' points, totalling 21,543.7."* Confirmation requires typing the slot count or an explicit second click.

**Tab 3 — History.** Rounds list — drill into a round showing every slot, the member, and their frozen points. Per-member view shows their selection timeline. Rounds are immutable; a mistake is corrected by **voiding** the round, which reverses its reset ledger entries (as new compensating rows, not deletions) and restores balances.

**Tab 4 — Setup.** As §7.

**Tab 5 — Import.** Upload / paste / sync raw weekly data.

---

## 9. Business rules & edge cases

| Case | Handling |
|---|---|
| Fewer eligible members than slots | Fill available slots, flag shortfall, block confirm until admin acknowledges |
| Member selected but has no submission that week | Reset still written — ledger is independent of submissions (fixes the week-56 defect) |
| Member's balance is 0 or negative at selection | Excluded by the minimum-balance rule; if manually forced, `points_at_selection` = 0 and no reset row is written |
| Ties at the cut line | Resolved by §6.3; the draft shows a tie indicator so the admin can review |
| Member leaves mid-cycle | Selection stands; admin reassigns the slot manually, which logs an override and does **not** refund the reset |
| Rates changed mid-cycle | Confirmed rounds keep their original `rule_version_id`; balances recalculate only for open weeks |
| Duplicate week import | Upsert on (`member_id`, `week`); the diff preview shows what will change |
| Same member ranks top twice in one round | Prevented by the unique constraint — one slot per member per round |
| Backfilled rounds | Marked `backfilled`, excluded from reset-integrity checks since their ledger history is incomplete |

---

## 10. VIP passenger selection

The VIP is a **second daily slot filled from the same cycle**, on a completely different basis from the Conductor: it rewards single-week event performance, uses **no accumulated balance**, and **triggers no reset**. Both roles are filled for every day of the cycle.

### 10.1 How it works today

Each VIP slot resolves to *"the nth-highest scorer on metric M in the selection week"*, read from the raw event columns, plus two consolation slots taken from the Conductor standings. The observed 14-slot sequence:

| Day | Rule | Week 63 result |
|---|---|---|
| 1 | VS 1st | Inktest |
| 2 | DS 1st | Evil Commandos |
| 3 | Kills 1st | Avcho |
| 4 | Donations 1st | JamesBuzz007 |
| 5 | VS 2nd | Rsel71 |
| 6 | DS 2nd | MISTAR RAISINS |
| 7 | Standings 15th | Marcin4 |
| 8 | VS 3rd | SkyPat |
| 9 | DS 3rd | Chewy86 |
| 10 | Kills 2nd | Hagar the Sheriff |
| 11 | Donations 2nd | J A M I E |
| 12 | VS 4th | cpt Sparrow |
| 13 | DS 4th | Kai50 |
| 14 | Standings 30th | kabapsnor |

A 1-week cycle takes the first 7 rows of this sequence.

**Key distinctions from the Conductor track:**

- Ranked on the **raw event score for that week only** (`VS Score`, `DS Points`, `WeekKills`, `Donations`) — not points, not balance, not cumulative.
- **No reset.** A VIP keeps their full balance and stays in contention for Conductor.
- A member **can hold both roles in the same cycle**, on different days — Inktest is Conductor on day 5 and VIP on day 1 in week 63. Only same-day collision needs preventing.
- VS is weighted heavily (4 of 14 slots), as is DS (4), versus Kills (2) and Donations (2). This weighting must be configurable, not hardcoded.

### 10.2 The dedup problem

The sheet's occurrence index is **manually bumped to skip members already used**: the DS 4th slot actually reads index **7**, not 4, because indices 4–6 were already taken elsewhere in the cycle. That hand-editing is exactly the fragility the app should remove.

**Specified behaviour:** resolve slots in sequence order, maintaining a used-set. For each slot, walk down that metric's leaderboard for the week and take the first member not already assigned a VIP slot in this round. The stored `source_rank` records the rank actually consumed, so the audit trail shows the skip rather than hiding it.

### 10.3 Consolation slots

Days 7 and 14 pull from the **Conductor standings** by position, not from an event leaderboard — a deliberate nod to consistent mid-table performers.

> **Defect found:** the slot labelled "15th" resolves to standings **rank 16** (Marcin4), while "30th" correctly resolves to rank 30. Either the label or the reference is off by one. Needs a decision before backfill — see open questions.

### 10.4 Data model additions

No new tables. `selections.role` carries `vip`, and the following fields apply to VIP rows:

| Field | Notes |
|---|---|
| `role` | `conductor` \| `vip` |
| `source_metric` | `vs`, `ds`, `kills`, `donations`, `standings` |
| `source_rank` | rank actually consumed after skips |
| `source_value` | raw score frozen at selection (e.g. 1,047,406.89) |
| `points_at_selection` | **null for VIP** — no balance is consumed |

Unique constraint becomes (`round_id`, `slot_index`, `role`), and (`round_id`, `member_id`, `role`) still prevents one member taking two VIP days.

### 10.5 Setup tab — VIP sequence editor

A separate section under Setup: an ordered, drag-to-reorder list of 14 slot rules, each row being `Metric` + `Nth` (or `Standings position`). Admins can change the weighting, swap in Zombie or Alliance Ex as a metric, or shorten the sequence. Validation: the sequence length must be at least `slots_per_week × 2`, and the preview shows who each rule would select for the current week, with skips marked.

Toggle: **Enable VIP track** (default on). With it off, rounds contain Conductor slots only.

### 10.6 Additional acceptance criteria

10. A round generates exactly `slot_count` VIP selections alongside `slot_count` Conductor selections.
11. No member holds two VIP slots in one round; skipped ranks are recorded in `source_rank`.
12. Confirming a round writes **no** ledger rows for VIP selections — every VIP's balance is unchanged.
13. Week 63 regenerated under the default sequence reproduces the 14 names in the table above.

### 10.7 Backfill caveat

`Historic` has VIP populated for only 41 of 91 rows, so VIP history before the cutover is partial. Backfill what exists, mark the rest `unknown`, and exclude VIP from any "times selected" fairness metric until the record is complete.

---

## 11. API sketch

```
GET  /api/standings?week=63&include=breakdown
GET  /api/members/:id/ledger
POST /api/selection-rounds/preview   { weeks_in_cycle, start_date }   → ranked draft, no writes
POST /api/selection-rounds           { weeks_in_cycle, start_date }   → creates draft
PATCH/api/selection-rounds/:id/slots { slot_index, member_id, reason }
POST /api/selection-rounds/:id/confirm   { expected_slot_count }      → idempotency key required
POST /api/selection-rounds/:id/void      { reason }
GET  /api/selection-rounds?status=confirmed
GET  /api/setup/rules   |  PUT /api/setup/rules   (creates a new version)
POST /api/imports/weekly-scores  { dry_run: true|false }
```

`confirm` is the only destructive-feeling operation: it must be transactional and idempotent, keyed so a double-submit cannot double-zero anyone.

---

## 12. Acceptance criteria

1. Toggling cycle length to 1 week yields exactly 7 selections; 2 weeks yields exactly 14.
2. After confirming a round, every selected member's balance reads exactly 0.00; every non-selected member's balance is unchanged to 5 decimals.
3. A member selected in week W and earning points in W+1 shows a balance equal to only their W+1 points.
4. Replaying the ledger from empty reproduces every current balance exactly.
5. A member with no submission in the selection week is still zeroed.
6. Voiding a round restores every affected balance to its pre-confirmation value.
7. Rate changes in Setup do not alter `points_at_selection` on any confirmed round.
8. Generating the same draft twice with unchanged data produces an identical order, ties included.
9. Backfilled weeks 51–63 reconcile to the `Historic` sheet: 91 selections, 7 per week, points matching to 2 decimals.

---

## 13. Open questions

1. **VS × 1,000** — confirm this is a unit conversion rather than a legacy fudge, so it can be modelled explicitly.
2. **Cooldown** — history shows repeats (Inktest 5× in 13 weeks). Should a minimum gap be enforced, or is the reset mechanic considered sufficient throttling?
3. **Squads bonus** — should partial submission (e.g. air only) score the full 20, as it does today?
4. **Zombie / Alliance Ex** — kept as disabled rules, or removed from the model?
5. **Cycle length** — is 1 or 2 weeks the full set, or should arbitrary N be supported? The spec supports any N; the UI exposes two.
6. **Reset timing** — should the reset be attributed to the week of selection or the week the cycle starts? Currently the former; it affects per-week reporting only.
7. **VIP "15th" slot** — it resolves to standings rank 16, not 15. Is the label wrong or the reference? This changes backfilled history.
8. **VIP metric weighting** — VS and DS each take 4 of 14 slots, Kills and Donations 2 each. Intentional, or an artefact of filling days?
9. **VIP / Conductor overlap** — currently a member can hold both roles in one cycle on different days. Keep, or exclude Conductors from the VIP pool?
10. **VIP eligibility** — should the same inactivity and exclusion filters as the Conductor track apply, or does any submitted score qualify?
