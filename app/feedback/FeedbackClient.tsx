"use client";

import { useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";

type FeedbackItem = {
  id: number;
  type: "bug" | "feature";
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "wont_fix";
  submittedByName: string;
  createdAt: string;
};

const STATUS_LABEL: Record<FeedbackItem["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Won't fix",
};

export function FeedbackClient({ initialItems, canChangeStatus }: { initialItems: FeedbackItem[]; canChangeStatus: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<"all" | "bug" | "feature">("all");
  const [type, setType] = useState<"bug" | "feature">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, description }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not submit this.");
      return;
    }
    const { item } = await res.json();
    setItems((prev) => [{ ...item, submittedByName: "You", createdAt: item.createdAt }, ...prev]);
    setTitle("");
    setDescription("");
  }

  async function handleStatusChange(id: number, status: FeedbackItem["status"]) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch(`/api/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  const visible = items.filter((i) => filter === "all" || i.type === filter);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 border border-neutral-200 rounded p-4 text-sm">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1">
            <input type="radio" name="type" checked={type === "bug"} onChange={() => setType("bug")} /> Bug
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="type" checked={type === "feature"} onChange={() => setType("feature")} /> Feature request
          </label>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short title"
          className="border border-neutral-300 rounded px-2 py-1"
          required
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, or what would you like to see?"
          className="border border-neutral-300 rounded px-2 py-1"
          rows={3}
        />
        {error && <span className="text-red-600">{error}</span>}
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="bg-accent text-accent-contrast rounded px-3 py-1 self-start disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Submit"}
        </button>
        {busy && <ProgressBar className="max-w-xs" />}
      </form>

      <div className="flex items-center gap-2 text-sm">
        {(["all", "bug", "feature"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2 py-1 border ${filter === f ? "bg-accent text-accent-contrast border-accent" : "border-neutral-300"}`}
          >
            {f === "all" ? "All" : f === "bug" ? "Bugs" : "Feature requests"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && <p className="text-neutral-500 text-sm">Nothing here yet.</p>}
        {visible.map((item) => (
          <div key={item.id} className="border border-neutral-200 rounded p-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {item.type === "bug" ? "🐛" : "💡"} {item.title}
              </span>
              {canChangeStatus ? (
                <select
                  value={item.status}
                  onChange={(e) => handleStatusChange(item.id, e.target.value as FeedbackItem["status"])}
                  className="border border-neutral-300 rounded px-2 py-0.5 text-xs"
                >
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-neutral-500">{STATUS_LABEL[item.status]}</span>
              )}
            </div>
            {item.description && <p className="text-sm text-neutral-600 whitespace-pre-wrap">{item.description}</p>}
            <span className="text-xs text-neutral-400">
              {item.submittedByName} - {new Date(item.createdAt).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
