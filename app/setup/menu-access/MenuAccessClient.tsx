"use client";

import { useEffect, useState } from "react";

type Role = "ADMIN" | "LEADER" | "MEMBER";
const ALL_ROLES: Role[] = ["ADMIN", "LEADER", "MEMBER"];

type MenuItem = { key: string; label: string; href: string; roles: Role[] };

export function MenuAccessClient() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
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

  function handleSelectChange(item: MenuItem, e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value as Role);
    setRoles(item.key, selected);
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
              {items.map((item) => (
                <tr key={item.key} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{item.label}</td>
                  <td className="py-2 pr-3 text-neutral-500 whitespace-nowrap">{item.href}</td>
                  <td className="py-2 pr-3">
                    <select
                      multiple
                      size={3}
                      value={item.roles}
                      disabled={busyKey === item.key}
                      onChange={(e) => handleSelectChange(item, e)}
                      className="border border-neutral-300 rounded px-2 py-1 text-xs w-32"
                    >
                      {ALL_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role.charAt(0) + role.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
