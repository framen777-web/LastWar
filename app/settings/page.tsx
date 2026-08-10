"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => setWhatsappNumber(data.settings?.whatsappNumber ?? ""))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsappNumber: whatsappNumber.replace(/[^0-9]/g, "") }),
    });
    setSaving(false);
    setSaved(true);
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

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || loading}
            className="bg-neutral-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved</span>}
        </div>
      </form>
    </div>
  );
}
