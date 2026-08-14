"use client";

import { useEffect, useState } from "react";

export function SettingsClient() {
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [minPasswordLength, setMinPasswordLength] = useState("8");
  const [week1StartDate, setWeek1StartDate] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setWhatsappNumber(data.settings?.whatsappNumber ?? "");
        setMinPasswordLength(data.settings?.minPasswordLength ?? "8");
        setWeek1StartDate(data.settings?.week1StartDate ?? "");
        setGeminiApiKeySet(!!data.geminiApiKeySet);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const body: Record<string, string> = {
      whatsappNumber: whatsappNumber.replace(/[^0-9]/g, ""),
      minPasswordLength: String(Math.max(1, Number(minPasswordLength) || 8)),
      week1StartDate,
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
          <label htmlFor="whatsapp" className="text-sm font-medium">
            WhatsApp number
          </label>
          <input
            id="whatsapp"
            type="tel"
            value={whatsappNumber}
            onChange={(e) => {
              setWhatsappNumber(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. 27821234567"
            disabled={loading}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          <p className="text-neutral-500 text-xs">
            Country code + number, digits only, no leading + or 0 (e.g. a South African 082 123 4567 becomes
            27821234567). Used by the "Share to WhatsApp" button on reports.
          </p>
        </div>

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

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || loading}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved</span>}
        </div>
      </form>
    </div>
  );
}
