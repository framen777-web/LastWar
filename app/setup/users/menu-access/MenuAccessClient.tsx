"use client";

import { useEffect, useState } from "react";

type Role = "ADMIN" | "LEADER" | "MEMBER";
const ALL_ROLES: Role[] = ["ADMIN", "LEADER", "MEMBER"];
const ROLE_LABELS: Record<Role, string> = { ADMIN: "Admin", LEADER: "Leader", MEMBER: "Member" };

type MenuItem = { key: string; label: string; href: string; roles: Role[] };

export function MenuAccessClient() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/menu-items");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setRoles(key: string, roles: Role[]) {
    setBusyKey(key);
    setError(null);
    const res = await fetch("/api/menu-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, roles }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
    } else {
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, roles } : i)));
    }
    setBusyKey(null);
  }

  function toggleRole(item: MenuItem, role: Role) {
    const next = item.roles.includes(role) ? item.roles.filter((r) => r !== role) : [...item.roles, role];
    setRoles(item.key, next);
  }

  function summaryText(roles: Role[]): string {
    if (roles.length === 0) return "None";
    if (roles.length === ALL_ROLES.length) return "All";
    return roles.map((r) => ROLE_LABELS[r]).join(", ");
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Menu Access</h1>
      <p className="text-neutral-500 text-sm">
        Which roles can see each button. A role not selected for a row means that button is invisible to that role
        - this controls visibility only, not the page&apos;s own access check, so removing a role here doesn&apos;t
        loosen or tighten what that role can actually reach if they already know the URL.
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3">Menu item</th>
                <th className="py-2 pr-3">Page</th>
                <th className="py-2 pr-3">Roles</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isOpen = openKey === item.key;
                return (
                  <tr key={item.key} className="border-b border-neutral-100">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{item.label}</td>
                    <td className="py-2 pr-3 text-neutral-500 whitespace-nowrap">{item.href}</td>
                    <td className="py-2 pr-3">
                      <div className="relative inline-block">
                        <button
                          type="button"
                          onClick={() => setOpenKey(isOpen ? null : item.key)}
                          disabled={busyKey === item.key}
                          className="border border-neutral-300 rounded px-2 py-1 text-xs w-36 text-left flex items-center justify-between gap-1 disabled:opacity-50 bg-surface-raised"
                        >
                          <span className="truncate">{summaryText(item.roles)}</span>
                          <span className="text-neutral-400 shrink-0">▾</span>
                        </button>

                        {isOpen && (
                          <>
                            {/* Tap-anywhere-outside-to-close backdrop - simpler and more
                                reliable on mobile than a document click listener. */}
                            <div className="fixed inset-0 z-30" onClick={() => setOpenKey(null)} />
                            <div className="absolute left-0 top-full mt-1 z-40 bg-surface-raised border border-neutral-300 rounded shadow-lg p-2 flex flex-col gap-1.5 w-36">
                              {ALL_ROLES.map((role) => (
                                <label key={role} className="flex items-center gap-2 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={item.roles.includes(role)}
                                    onChange={() => toggleRole(item, role)}
                                    className="w-4 h-4"
                                  />
                                  {ROLE_LABELS[role]}
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
