"use client";

import { useEffect, useState } from "react";
import { SUMMARY_MODE_LABELS, type SummaryMode } from "@/lib/reports/summaryMode";

export function SettingsClient() {
  const [minPasswordLength, setMinPasswordLength] = useState("8");
  const [r1BottomWeeksWindow, setR1BottomWeeksWindow] = useState("5");
  const [mvpSummaryMode, setMvpSummaryMode] = useState<SummaryMode>("sum");
  const [week1StartDate, setWeek1StartDate] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false);
  const [generalPassword, setGeneralPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setMinPasswordLength(data.settings?.minPasswordLength ?? "8");
        setR1BottomWeeksWindow(data.settings?.r1BottomWeeksWindow ?? "5");
        setMvpSummaryMode((data.settings?.mvpSummaryMode as SummaryMode) ?? "sum");
        setWeek1StartDate(data.settings?.week1StartDate ?? "");
        setGeminiApiKeySet(!!data.geminiApiKeySet);
        setGeneralPassword(data.settings?.generalPassword ?? "");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);

    const minLength = Math.max(1, Number(minPasswordLength) || 8);
    if (generalPassword && generalPassword.length < minLength) {
      setError(`General password must be at least ${minLength} characters.`);
      setSaving(false);
      return;
    }

    const body: Record<string, string> = {
      minPasswordLength: String(minLength),
      r1BottomWeeksWindow: String(Math.max(1, Number(r1BottomWeeksWindow) || 5)),
      mvpSummaryMode,
      week1StartDate,
      generalPassword,
    };
    // Blank means "leave the saved key alone" - only send it when the admin typed a new one.
    if (geminiApiKey) body.geminiApiKey = geminiApiKey;

    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setSaved(true);
    if (geminiApiKey) {
      setGeminiApiKeySet(true);
      setGeminiApiKey("");
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm">
      <h1 className="text-xl font-semibold">Settings</h1>

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="minPasswordLength" className="text-sm font-medium">
            Minimum password length
          </label>
          <input
            id="minPasswordLength"
            type="number"
            min={1}
            value={minPasswordLength}
            onChange={(e) => {
              setMinPasswordLength(e.target.value);
              setSaved(false);
            }}
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2 w-32"
          />
          <p className="text-neutral-500 text-xs">Applies to admin setup, self-service password changes, and Setup → Users.</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="r1BottomWeeksWindow" className="text-sm font-medium">
            R1 default bottom panel weeks
          </label>
          <input
            id="r1BottomWeeksWindow"
            type="number"
            min={1}
            value={r1BottomWeeksWindow}
            onChange={(e) => {
              setR1BottomWeeksWindow(e.target.value);
              setSaved(false);
            }}
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2 w-32"
          />
          <p className="text-neutral-500 text-xs">
            Default averaging window for the R1 report&apos;s bottom panel. Only affects weeks that haven&apos;t
            been viewed yet - once a week&apos;s report has been generated, its own window is pinned and this
            default no longer affects it.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mvpSummaryMode" className="text-sm font-medium">
            MVP score summary mode
          </label>
          <select
            id="mvpSummaryMode"
            value={mvpSummaryMode}
            onChange={(e) => {
              setMvpSummaryMode(e.target.value as SummaryMode);
              setSaved(false);
            }}
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2 w-48"
          >
            {(Object.entries(SUMMARY_MODE_LABELS) as [SummaryMode, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <p className="text-neutral-500 text-xs">
            How each member&apos;s MVP score collapses into one number in the Alliance Detail Report&apos;s
            Summary view. MVP isn&apos;t a Category (it&apos;s a computed score, not an uploaded stat), so it
            gets its own setting here rather than in Setup → Categories. Defaults to Sum, matching
            how it&apos;s worked until now.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="week1StartDate" className="text-sm font-medium">
            Week 1 start date
          </label>
          <input
            id="week1StartDate"
            type="date"
            value={week1StartDate}
            onChange={(e) => {
              setWeek1StartDate(e.target.value);
              setSaved(false);
            }}
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          <p className="text-neutral-500 text-xs">The calendar date week 1 started, so week numbers can be converted to real dates.</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="geminiApiKey" className="text-sm font-medium">
            Gemini API key
          </label>
          <input
            id="geminiApiKey"
            type="password"
            value={geminiApiKey}
            onChange={(e) => {
              setGeminiApiKey(e.target.value);
              setSaved(false);
            }}
            placeholder={geminiApiKeySet ? "•••••••• (saved — leave blank to keep it)" : "Not set"}
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          <p className="text-neutral-500 text-xs">
            Used by the screenshot AI pipeline. Stored in the app database, not an environment secret — only
            enter this if you understand that tradeoff.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="generalPassword" className="text-sm font-medium">
            General password
          </label>
          <input
            id="generalPassword"
            type="text"
            value={generalPassword}
            onChange={(e) => {
              setGeneralPassword(e.target.value);
              setSaved(false);
            }}
            placeholder="Not set"
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          <p className="text-neutral-500 text-xs">
            Used to log in by any member with no password of their own set (Setup → Users). Shown in plain text,
            not masked, so you can read and share it. Never works for Admin accounts - they always need their own
            password.
          </p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || loading}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved</span>}
        </div>
      </form>
    </div>
  );
}
