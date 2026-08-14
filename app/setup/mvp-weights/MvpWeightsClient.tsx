"use client";

import { useEffect, useState } from "react";

type Weights = {
  vs: number;
  ds: number;
  hqMover: number;
  donations: number;
  kills: number;
  squad: number;
  canyonStorm: number;
  zombieSiege: number;
  allianceExercise: number;
};

const DEFAULT_WEIGHTS: Weights = {
  vs: 0.4,
  ds: 0.2,
  hqMover: 0.05,
  donations: 0.2,
  kills: 0.05,
  squad: 0.05,
  canyonStorm: 0.05,
  zombieSiege: 0,
  allianceExercise: 0,
};

const ITEMS: { key: keyof Weights; label: string }[] = [
  { key: "vs", label: "VS" },
  { key: "ds", label: "DS" },
  { key: "hqMover", label: "HQ Mover" },
  { key: "donations", label: "Donations for week" },
  { key: "kills", label: "Kills for week" },
  { key: "squad", label: "Squad improvement" },
  { key: "canyonStorm", label: "Canyon Storm" },
  { key: "zombieSiege", label: "Zombie Siege" },
  { key: "allianceExercise", label: "Alliance Exercise" },
];

export function MvpWeightsClient() {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/mvp/weights")
      .then((res) => res.json())
      .then((data) => setWeights({ ...DEFAULT_WEIGHTS, ...data.weights }))
      .finally(() => setLoading(false));
  }, []);

  const total = Object.values(weights).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  const totalOk = Math.abs(total - 1) < 0.0001;

  function setWeight(key: keyof Weights, value: string) {
    setSaved(false);
    setWeights((w) => ({ ...w, [key]: Number(value) }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/mvp/weights", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weights),
    });
    const data = await res.json();
    if (res.ok) {
      setWeights(data.weights);
      setSaved(true);
    }
    setSaving(false);
  }

  function handleReset() {
    setSaved(false);
    setWeights(DEFAULT_WEIGHTS);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">MVP Weighting</h1>

      <div className="border border-neutral-200 rounded max-w-sm">
        <div className="px-4 py-2 border-b border-neutral-200 font-semibold">Alliance MVP Weighting</div>
        <div className="p-4 flex flex-col gap-2">
          {ITEMS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <label htmlFor={item.key} className="text-neutral-700">
                {item.label}
              </label>
              <input
                id={item.key}
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={weights[item.key]}
                disabled={loading}
                onChange={(e) => setWeight(item.key, e.target.value)}
                className="border border-neutral-300 rounded px-2 py-1 w-20 text-right"
              />
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 text-sm border-t border-neutral-200 pt-2 mt-1 font-semibold">
            <span>Total</span>
            <span className={totalOk ? "text-green-700" : "text-amber-600"}>{total.toFixed(2)}</span>
          </div>
          {!totalOk && (
            <p className="text-amber-600 text-xs">
              Weights don&apos;t add up to 1.00 — scores will still compute, just not on the usual 0–100 scale.
            </p>
          )}
        </div>
      </div>

      <p className="text-neutral-400 text-xs max-w-sm">Used by: MVP Report, R1 Report</p>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={handleReset} disabled={loading} className="border border-neutral-300 rounded px-4 py-2 text-sm">
          Reset to defaults
        </button>
        {saved && <span className="text-green-700 text-sm">Saved</span>}
      </div>
    </div>
  );
}
