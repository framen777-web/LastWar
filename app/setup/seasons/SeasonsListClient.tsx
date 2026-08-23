"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Season = {
  id: number;
  name: string;
  weekStart: number;
  weekEnd: number;
  totalBoxes: number;
  status: string;
};

type FormState = { name: string; weekStart: string; weekEnd: string; totalBoxes: string };

const EMPTY_FORM: FormState = { name: "", weekStart: "", weekEnd: "", totalBoxes: "" };

export function SeasonsListClient() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const res = await fetch("/api/seasons");
    const data = await res.json();
    setSeasons(data.seasons ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const res = await fetch("/api/seasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        weekStart: Number(form.weekStart),
        weekEnd: Number(form.weekEnd),
        totalBoxes: Number(form.totalBoxes),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      const errs: Record<string, string> = {};
      for (const err of data.errors ?? []) errs[err.field] = err.message;
      setErrors(errs);
      return;
    }
    setCreating(false);
    setForm(EMPTY_FORM);
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Seasons</h1>
        {!creating && (
          <button onClick={() => setCreating(true)} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
            New season
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="border border-neutral-200 rounded p-4 flex flex-col gap-3 max-w-md">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="border border-neutral-300 rounded px-3 py-2"
              placeholder="e.g. Season 6"
            />
            {errors.name && <p className="text-red-600 text-xs">{errors.name}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Week start</label>
              <input
                type="number"
                min={1}
                value={form.weekStart}
                onChange={(e) => setForm((f) => ({ ...f, weekStart: e.target.value }))}
                className="border border-neutral-300 rounded px-3 py-2 w-24"
              />
              {errors.weekStart && <p className="text-red-600 text-xs">{errors.weekStart}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Week end</label>
              <input
                type="number"
                min={1}
                value={form.weekEnd}
                onChange={(e) => setForm((f) => ({ ...f, weekEnd: e.target.value }))}
                className="border border-neutral-300 rounded px-3 py-2 w-24"
              />
              {errors.weekEnd && <p className="text-red-600 text-xs">{errors.weekEnd}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Total boxes</label>
            <input
              type="number"
              min={0}
              value={form.totalBoxes}
              onChange={(e) => setForm((f) => ({ ...f, totalBoxes: e.target.value }))}
              className="border border-neutral-300 rounded px-3 py-2 w-32"
            />
            {errors.totalBoxes && <p className="text-red-600 text-xs">{errors.totalBoxes}</p>}
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50">
              {saving ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setForm(EMPTY_FORM);
                setErrors({});
              }}
              className="border border-neutral-300 rounded px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : seasons.length === 0 ? (
        <p className="text-neutral-500 text-sm">No seasons yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse max-w-2xl">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Weeks</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Total boxes</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 font-medium">
                    <Link href={`/setup/seasons/${s.id}`} className="text-accent hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-neutral-500">
                    {s.weekStart}–{s.weekEnd}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        s.status === "final" ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {s.status === "final" ? "Final" : "Draft"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-neutral-500">{s.totalBoxes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
