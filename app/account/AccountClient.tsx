"use client";

import { useEffect, useState } from "react";
import { THEMES } from "@/lib/theme";

export function AccountClient({
  name,
  role,
  initialTheme,
  initialWhatsapp,
  initialEmail,
  initialLoginAlias,
}: {
  name: string;
  role: "ADMIN" | "LEADER" | "MEMBER";
  initialTheme: string;
  initialWhatsapp: string;
  initialEmail: string;
  initialLoginAlias: string;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [themeError, setThemeError] = useState<string | null>(null);

  const [whatsapp, setWhatsapp] = useState(initialWhatsapp);
  const [email, setEmail] = useState(initialEmail);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSaved, setContactSaved] = useState(false);
  const [savingContact, setSavingContact] = useState(false);

  const [loginAlias, setLoginAlias] = useState(initialLoginAlias);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasSaved, setAliasSaved] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [minPasswordLength, setMinPasswordLength] = useState(8);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const n = Number(data.settings?.minPasswordLength);
        if (Number.isInteger(n) && n > 0) setMinPasswordLength(n);
      })
      .catch(() => {});
  }, []);

  async function selectTheme(key: string) {
    const previous = theme;
    setTheme(key);
    setThemeError(null);
    document.documentElement.dataset.theme = key;

    const res = await fetch("/api/account/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: key }),
    });

    if (!res.ok) {
      setTheme(previous);
      document.documentElement.dataset.theme = previous;
      setThemeError("Couldn't save your colour scheme. Check your connection and try again.");
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (newPassword.length < minPasswordLength) {
      setPasswordError(`New password must be at least ${minPasswordLength} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }

    setSavingPassword(true);
    const res = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    setSavingPassword(false);

    if (!res.ok) {
      setPasswordError(data.error ?? "Something went wrong.");
      return;
    }

    setPasswordSaved(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContactError(null);
    setContactSaved(false);
    setSavingContact(true);

    const res = await fetch("/api/account/contact", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsapp, email }),
    });
    const data = await res.json();
    setSavingContact(false);

    if (!res.ok) {
      setContactError(data.error ?? "Something went wrong.");
      return;
    }
    setContactSaved(true);
  }

  async function handleAliasSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAliasError(null);
    setAliasSaved(false);
    setSavingAlias(true);

    const res = await fetch("/api/account/alias", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginAlias }),
    });
    const data = await res.json();
    setSavingAlias(false);

    if (!res.ok) {
      setAliasError(data.error ?? "Something went wrong.");
      return;
    }
    setAliasSaved(true);
  }

  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Signed in as {name} · {role}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Login alias</h2>
        <p className="text-neutral-500 text-sm">
          Your reports always show your screen name ({name}). If it&apos;s awkward to type when logging in,
          set a plain-text alias here, or use your email/phone below instead - any of them work at the login screen.
        </p>

        <form onSubmit={handleAliasSubmit} className="flex flex-col gap-3 max-w-sm">
          <input
            type="text"
            value={loginAlias}
            onChange={(e) => {
              setLoginAlias(e.target.value);
              setAliasSaved(false);
            }}
            placeholder="e.g. frans"
            className="border border-neutral-300 rounded px-3 py-2"
          />
          {aliasError && <p className="text-red-600 text-sm">{aliasError}</p>}
          {aliasSaved && <p className="text-green-700 text-sm">Saved.</p>}
          <button
            type="submit"
            disabled={savingAlias}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {savingAlias ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="font-semibold">Contact info</h2>
        <p className="text-neutral-500 text-sm">
          Optional. Also usable to log in (see above), and if you ever get locked out, this is how an
          admin can reach you to arrange a password reset.
        </p>

        <form onSubmit={handleContactSubmit} className="flex flex-col gap-3 max-w-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="contactWhatsapp" className="text-sm font-medium">
              WhatsApp number
            </label>
            <input
              id="contactWhatsapp"
              type="tel"
              value={whatsapp}
              onChange={(e) => {
                setWhatsapp(e.target.value);
                setContactSaved(false);
              }}
              placeholder="e.g. 27821234567"
              className="border border-neutral-300 rounded px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="contactEmail" className="text-sm font-medium">
              Email
            </label>
            <input
              id="contactEmail"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setContactSaved(false);
              }}
              className="border border-neutral-300 rounded px-3 py-2"
            />
          </div>

          {contactError && <p className="text-red-600 text-sm">{contactError}</p>}
          {contactSaved && <p className="text-green-700 text-sm">Saved.</p>}

          <button
            type="submit"
            disabled={savingContact}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {savingContact ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="font-semibold">Appearance</h2>
        <p className="text-neutral-500 text-sm">Colour scheme. Applies immediately.</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTheme(t.key)}
              aria-pressed={theme === t.key}
              className={`rounded-lg overflow-hidden border-2 text-left transition-colors ${
                theme === t.key ? "border-accent" : "border-neutral-200 hover:border-neutral-400"
              }`}
            >
              <div className="p-3" style={{ backgroundColor: t.preview.surface }}>
                <div className="rounded p-2 flex items-center justify-between" style={{ backgroundColor: t.preview.raised }}>
                  <span className="text-xs font-medium" style={{ color: t.preview.text }}>
                    Aa
                  </span>
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.preview.accent }} />
                </div>
              </div>
              <div className="px-3 py-2 bg-surface-raised">
                <div className="text-sm font-medium">{t.label}</div>
                {t.isAccessibilityOption && <div className="text-neutral-500 text-xs">Accessibility option</div>}
              </div>
            </button>
          ))}
        </div>

        {themeError && <p className="text-red-600 text-sm">{themeError}</p>}
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="font-semibold">Change password</h2>

        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3 max-w-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="newPassword" className="text-sm font-medium">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={minPasswordLength}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={minPasswordLength}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-2"
            />
          </div>

          {passwordError && <p className="text-red-600 text-sm">{passwordError}</p>}
          {passwordSaved && <p className="text-green-700 text-sm">Password changed.</p>}

          <button
            type="submit"
            disabled={savingPassword}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {savingPassword ? "Saving…" : "Change password"}
          </button>
        </form>
      </section>
    </div>
  );
}
