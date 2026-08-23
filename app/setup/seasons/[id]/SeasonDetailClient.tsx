"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SeasonBasics = {
  id: number;
  name: string;
  weekStart: number;
  weekEnd: number;
  totalBoxes: number;
  status: string;
  finalizedAt: string | null;
};

type CategoryOption = { key: string; name: string };
type CategoryPointsServerRow = { categoryKey: string; mode: string; pointsPerUnit: number | null; unitSize: number | null; flatValue: number | null };
type ExtraItem = {
  id: number;
  key: string;
  name: string;
  mode: string;
  pointsPerUnit: number | null;
  unitSize: number | null;
  flatValue: number | null;
  valueCount: number;
};
type BandServerRow = { order: number; commanderCount: number; pctOfBoxes: number };

type RateFlatState = { mode: "rate" | "flat"; pointsPerUnit: string; unitSize: string; flatValue: string };

function RateFlatFields({
  state,
  onChange,
  locked,
}: {
  state: RateFlatState;
  onChange: (patch: Partial<RateFlatState>) => void;
  locked: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        value={state.mode}
        disabled={locked}
        onChange={(e) => onChange({ mode: e.target.value as "rate" | "flat" })}
        className="border border-neutral-300 rounded px-2 py-1"
      >
        <option value="rate">Rate</option>
        <option value="flat">Flat</option>
      </select>
      {state.mode === "rate" ? (
        <>
          <input
            type="number"
            step="any"
            placeholder="points"
            disabled={locked}
            value={state.pointsPerUnit}
            onChange={(e) => onChange({ pointsPerUnit: e.target.value })}
            className="border border-neutral-300 rounded px-2 py-1 w-20"
          />
          <span className="text-neutral-500">per</span>
          <input
            type="number"
            step="any"
            placeholder="unit size"
            disabled={locked}
            value={state.unitSize}
            onChange={(e) => onChange({ unitSize: e.target.value })}
            className="border border-neutral-300 rounded px-2 py-1 w-24"
          />
        </>
      ) : (
        <input
          type="number"
          step="any"
          placeholder="points"
          disabled={locked}
          value={state.flatValue}
          onChange={(e) => onChange({ flatValue: e.target.value })}
          className="border border-neutral-300 rounded px-2 py-1 w-20"
        />
      )}
    </div>
  );
}

type CategoryRowState = { categoryKey: string; name: string; included: boolean } & RateFlatState;

function toRateFlatState(row: { mode: string; pointsPerUnit: number | null; unitSize: number | null; flatValue: number | null } | undefined): RateFlatState {
  return {
    mode: row?.mode === "flat" ? "flat" : "rate",
    pointsPerUnit: row?.pointsPerUnit !== undefined && row?.pointsPerUnit !== null ? String(row.pointsPerUnit) : "",
    unitSize: row?.unitSize !== undefined && row?.unitSize !== null ? String(row.unitSize) : "",
    flatValue: row?.flatValue !== undefined && row?.flatValue !== null ? String(row.flatValue) : "",
  };
}

export function SeasonDetailClient({ seasonId }: { seasonId: number }) {
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<SeasonBasics | null>(null);
  const [categoryRows, setCategoryRows] = useState<CategoryRowState[]>([]);
  const [extraItems, setExtraItems] = useState<ExtraItem[]>([]);
  const [bandRows, setBandRows] = useState<{ commanderCount: string; pctOfBoxes: string }[]>([]);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/seasons/${seasonId}`);
    const data = await res.json();
    setSeason(data.season);
    const categories: CategoryOption[] = data.categories ?? [];
    const categoryPoints: CategoryPointsServerRow[] = data.categoryPoints ?? [];
    setCategoryRows(
      categories.map((c) => {
        const cp = categoryPoints.find((p) => p.categoryKey === c.key);
        return { categoryKey: c.key, name: c.name, included: !!cp, ...toRateFlatState(cp) };
      })
    );
    setExtraItems(data.extraItems ?? []);
    const bands: BandServerRow[] = data.bands ?? [];
    setBandRows(bands.map((b) => ({ commanderCount: String(b.commanderCount), pctOfBoxes: String(b.pctOfBoxes) })));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [seasonId]);

  if (loading || !season) return <p className="text-neutral-500 text-sm">Loading…</p>;

  const locked = season.status === "final";

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/setup/seasons" className="text-xs text-accent hover:underline">
            ← Seasons
          </Link>
          <h1 className="text-xl font-semibold">{season.name}</h1>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${locked ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-700"}`}
        >
          {locked ? "Final" : "Draft"}
        </span>
      </div>

      <BasicsSection season={season} locked={locked} onSaved={setSeason} />

      <CategoryPointsSection seasonId={seasonId} rows={categoryRows} setRows={setCategoryRows} locked={locked} />

      <ExtraItemsSection seasonId={seasonId} items={extraItems} setItems={setExtraItems} locked={locked} />

      {!locked && (
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Upload extras</h2>
          {extraItems.length === 0 ? (
            <span className="text-neutral-400 text-sm" title="Add at least one season-specific item first">
              Upload extras (add at least one season-specific item first)
            </span>
          ) : (
            <Link
              href={`/setup/seasons/${seasonId}/upload-extras`}
              className="border border-neutral-300 rounded px-4 py-2 text-sm hover:bg-neutral-50 self-start"
            >
              Upload extras…
            </Link>
          )}
        </div>
      )}

      <BandsSection seasonId={seasonId} bandRows={bandRows} setBandRows={setBandRows} locked={locked} />

      <FinalizeSection seasonId={seasonId} locked={locked} finalizedAt={season.finalizedAt} onChanged={load} />
    </div>
  );
}

function BasicsSection({
  season,
  locked,
  onSaved,
}: {
  season: SeasonBasics;
  locked: boolean;
  onSaved: (s: SeasonBasics) => void;
}) {
  const [name, setName] = useState(season.name);
  const [weekStart, setWeekStart] = useState(String(season.weekStart));
  const [weekEnd, setWeekEnd] = useState(String(season.weekEnd));
  const [totalBoxes, setTotalBoxes] = useState(String(season.totalBoxes));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/seasons/${season.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, weekStart: Number(weekStart), weekEnd: Number(weekEnd), totalBoxes: Number(totalBoxes) }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.errors?.[0]?.message ?? data.error ?? "Save failed.");
      return;
    }
    onSaved(data.season);
    setSaved(true);
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
      <h2 className="font-semibold">Season basics</h2>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Name</label>
        <input
          type="text"
          disabled={locked}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="border border-neutral-300 rounded px-3 py-2 max-w-xs"
        />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Week start</label>
          <input
            type="number"
            min={1}
            disabled={locked}
            value={weekStart}
            onChange={(e) => {
              setWeekStart(e.target.value);
              setSaved(false);
            }}
            className="border border-neutral-300 rounded px-3 py-2 w-24"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Week end</label>
          <input
            type="number"
            min={1}
            disabled={locked}
            value={weekEnd}
            onChange={(e) => {
              setWeekEnd(e.target.value);
              setSaved(false);
            }}
            className="border border-neutral-300 rounded px-3 py-2 w-24"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Total boxes</label>
          <input
            type="number"
            min={0}
            disabled={locked}
            value={totalBoxes}
            onChange={(e) => {
              setTotalBoxes(e.target.value);
              setSaved(false);
            }}
            className="border border-neutral-300 rounded px-3 py-2 w-32"
          />
        </div>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!locked && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved</span>}
        </div>
      )}
    </div>
  );
}

function CategoryPointsSection({
  seasonId,
  rows,
  setRows,
  locked,
}: {
  seasonId: number;
  rows: CategoryRowState[];
  setRows: React.Dispatch<React.SetStateAction<CategoryRowState[]>>;
  locked: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchRow(categoryKey: string, patch: Partial<CategoryRowState>) {
    setSaved(false);
    setRows((prev) => prev.map((r) => (r.categoryKey === categoryKey ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const items = rows
      .filter((r) => r.included)
      .map((r) => ({
        categoryKey: r.categoryKey,
        mode: r.mode,
        pointsPerUnit: r.mode === "rate" ? Number(r.pointsPerUnit) || 0 : null,
        unitSize: r.mode === "rate" ? Number(r.unitSize) || 1 : null,
        flatValue: r.mode === "flat" ? Number(r.flatValue) || 0 : null,
      }));
    const res = await fetch(`/api/seasons/${seasonId}/category-points`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed.");
      return;
    }
    setSaved(true);
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
      <h2 className="font-semibold">Category points</h2>
      <p className="text-neutral-500 text-xs">
        Check a category to count it toward this season&apos;s score. Rate scores (weekly value / unit size) × points per
        unit; Flat scores a fixed value for any week the member has a value at all.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.categoryKey} className="flex items-center gap-3 text-sm flex-wrap">
            <label className="flex items-center gap-2 w-40 shrink-0">
              <input
                type="checkbox"
                disabled={locked}
                checked={row.included}
                onChange={(e) => patchRow(row.categoryKey, { included: e.target.checked })}
              />
              {row.name}
            </label>
            {row.included && <RateFlatFields state={row} onChange={(patch) => patchRow(row.categoryKey, patch)} locked={locked} />}
          </div>
        ))}
        {rows.length === 0 && <p className="text-neutral-400 text-sm">No active categories to score.</p>}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!locked && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save category points"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved</span>}
        </div>
      )}
    </div>
  );
}

function ExtraItemsSection({
  seasonId,
  items,
  setItems,
  locked,
}: {
  seasonId: number;
  items: ExtraItem[];
  setItems: React.Dispatch<React.SetStateAction<ExtraItem[]>>;
  locked: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/extra-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();
    setAdding(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't add item.");
      return;
    }
    setItems((prev) => [...prev, data.item]);
    setNewName("");
  }

  async function handleDelete(item: ExtraItem) {
    const message =
      item.valueCount > 0
        ? `This will delete ${item.valueCount} uploaded value(s) too for "${item.name}". Continue?`
        : `Delete "${item.name}"?`;
    if (!confirm(message)) return;
    await fetch(`/api/seasons/${seasonId}/extra-items/${item.id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  async function handleItemSave(item: ExtraItem, state: RateFlatState) {
    const res = await fetch(`/api/seasons/${seasonId}/extra-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: state.mode,
        pointsPerUnit: state.mode === "rate" ? Number(state.pointsPerUnit) || 0 : null,
        unitSize: state.mode === "rate" ? Number(state.unitSize) || 1 : null,
        flatValue: state.mode === "flat" ? Number(state.flatValue) || 0 : null,
      }),
    });
    const data = await res.json();
    if (res.ok) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...data.item } : i)));
    return res.ok;
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
      <h2 className="font-semibold">Season-specific items</h2>
      <p className="text-neutral-500 text-xs">
        Items that don&apos;t exist outside this season (e.g. CrystalGold, Capture) - their values come from a one-time
        upload, not the weekly pipeline.
      </p>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <ExtraItemRow key={item.id} item={item} locked={locked} onSave={handleItemSave} onDelete={() => handleDelete(item)} />
        ))}
        {items.length === 0 && <p className="text-neutral-400 text-sm">No season-specific items yet.</p>}
      </div>
      {!locked && (
        <div className="flex items-center gap-2 pt-2 border-t border-neutral-200">
          <input
            type="text"
            placeholder="Item name, e.g. CrystalGold"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2 text-sm w-56"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="border border-neutral-300 rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add item"}
          </button>
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}

function ExtraItemRow({
  item,
  locked,
  onSave,
  onDelete,
}: {
  item: ExtraItem;
  locked: boolean;
  onSave: (item: ExtraItem, state: RateFlatState) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [state, setState] = useState<RateFlatState>(toRateFlatState(item));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    const ok = await onSave(item, state);
    setSaving(false);
    setSaved(ok);
  }

  return (
    <div className="flex items-center gap-3 text-sm flex-wrap">
      <span className="w-40 shrink-0 font-medium">
        {item.name}
        {item.valueCount > 0 && <span className="text-neutral-400 text-xs ml-1">({item.valueCount} uploaded)</span>}
      </span>
      <RateFlatFields
        state={state}
        onChange={(patch) => {
          setState((s) => ({ ...s, ...patch }));
          setSaved(false);
        }}
        locked={locked}
      />
      {!locked && (
        <>
          <button onClick={handleSave} disabled={saving} className="border border-neutral-300 rounded px-3 py-1 text-xs disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-green-700 text-xs">Saved</span>}
          <button onClick={onDelete} className="text-red-600 hover:text-red-800 text-xs">
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function BandsSection({
  seasonId,
  bandRows,
  setBandRows,
  locked,
}: {
  seasonId: number;
  bandRows: { commanderCount: string; pctOfBoxes: string }[];
  setBandRows: React.Dispatch<React.SetStateAction<{ commanderCount: string; pctOfBoxes: string }[]>>;
  locked: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const totalCommanders = bandRows.reduce((sum, b) => sum + (Number(b.commanderCount) || 0), 0);
  const totalPct = bandRows.reduce((sum, b) => sum + (Number(b.pctOfBoxes) || 0), 0);
  const pctOk = Math.abs(totalPct - 100) < 0.01;

  function patch(i: number, field: "commanderCount" | "pctOfBoxes", value: string) {
    setSaved(false);
    setBandRows((prev) => prev.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)));
  }

  function removeRow(i: number) {
    setSaved(false);
    setBandRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addRow() {
    setSaved(false);
    setBandRows((prev) => [...prev, { commanderCount: "5", pctOfBoxes: "0" }]);
  }

  async function handleSave() {
    setSaving(true);
    const bands = bandRows.map((b) => ({ commanderCount: Number(b.commanderCount) || 1, pctOfBoxes: Number(b.pctOfBoxes) || 0 }));
    const res = await fetch(`/api/seasons/${seasonId}/bands`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bands }),
    });
    setSaving(false);
    setSaved(res.ok);
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
      <h2 className="font-semibold">Reward bands</h2>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-xs font-medium text-neutral-500">
          <span className="w-10">Order</span>
          <span className="w-32">Commanders</span>
          <span className="w-32">% of boxes</span>
        </div>
        {bandRows.map((b, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="w-10 text-neutral-500">{i + 1}</span>
            <input
              type="number"
              min={1}
              disabled={locked}
              value={b.commanderCount}
              onChange={(e) => patch(i, "commanderCount", e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1 w-24"
            />
            <input
              type="number"
              min={0}
              step="any"
              disabled={locked}
              value={b.pctOfBoxes}
              onChange={(e) => patch(i, "pctOfBoxes", e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1 w-24"
            />
            {!locked && (
              <button onClick={() => removeRow(i)} className="text-red-600 hover:text-red-800 text-xs">
                Remove
              </button>
            )}
          </div>
        ))}
        {bandRows.length === 0 && <p className="text-neutral-400 text-sm">No bands configured yet.</p>}
      </div>
      {!locked && (
        <button onClick={addRow} className="border border-neutral-300 rounded px-3 py-1.5 text-sm self-start">
          Add band
        </button>
      )}
      {bandRows.length > 0 && (
        <p className={`text-xs ${pctOk ? "text-neutral-500" : "text-amber-600"}`}>
          Bands cover ranks 1–{totalCommanders} ({totalCommanders} commander{totalCommanders === 1 ? "" : "s"}), {totalPct.toFixed(2)}% of
          boxes allocated{!pctOk && " — doesn't add up to 100%"}
        </p>
      )}
      {!locked && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save bands"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved</span>}
        </div>
      )}
    </div>
  );
}

function FinalizeSection({
  seasonId,
  locked,
  finalizedAt,
  onChanged,
}: {
  seasonId: number;
  locked: boolean;
  finalizedAt: string | null;
  onChanged: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinalize() {
    if (
      !confirm(
        "This locks scoring config and freezes the current results as the official reward list. You can reopen it later if needed."
      )
    )
      return;
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/finalize`, { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Finalize failed.");
      return;
    }
    onChanged();
  }

  async function handleReopen() {
    if (!confirm("This deletes the frozen results - the report will show live numbers again until you re-finalize.")) return;
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/reopen`, { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Reopen failed.");
      return;
    }
    onChanged();
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
      <h2 className="font-semibold">{locked ? "Finalized" : "Finalize"}</h2>
      {locked ? (
        <>
          <p className="text-neutral-500 text-sm">
            Finalized{finalizedAt ? ` on ${new Date(finalizedAt).toLocaleString()}` : ""}. The Season Report now reads the frozen result
            rows instead of live data.
          </p>
          <button
            onClick={handleReopen}
            disabled={running}
            className="border border-neutral-300 rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {running ? "Reopening…" : "Reopen for editing"}
          </button>
        </>
      ) : (
        <>
          <p className="text-neutral-500 text-sm">
            Freezes the current live computation as this season&apos;s official reward list. Scoring config and bands are
            locked from further edits until reopened.
          </p>
          <button
            onClick={handleFinalize}
            disabled={running}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {running ? "Finalizing…" : "Finalize season"}
          </button>
        </>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
