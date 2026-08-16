"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "ADMIN" | "LEADER" | "MEMBER";
const ALL_ROLES: Role[] = ["ADMIN", "LEADER", "MEMBER"];
const ROLE_LABELS: Record<Role, string> = { ADMIN: "Admin", LEADER: "Leader", MEMBER: "Member" };

type MenuItem = { key: string; label: string; href: string; parentKey: string | null; roles: Role[] };

function getAllDescendantKeys(key: string, byParent: Map<string | null, MenuItem[]>): string[] {
  const direct = byParent.get(key) ?? [];
  return direct.flatMap((child) => [child.key, ...getAllDescendantKeys(child.key, byParent)]);
}

export function MenuAccessClient() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openComboboxKey, setOpenComboboxKey] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  // Grouped by parentKey (null = main menu items) - mirrors the real nav tree exactly,
  // since parentKey is set from prisma/seed.ts's MENU_ITEMS to match the actual hub pages.
  const byParent = useMemo(() => {
    const map = new Map<string | null, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.parentKey) ?? [];
      list.push(item);
      map.set(item.parentKey, list);
    }
    return map;
  }, [items]);

  async function patchRoles(key: string, roles: Role[]): Promise<boolean> {
    const res = await fetch("/api/menu-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, roles }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      return false;
    }
    return true;
  }

  async function handleRolesChange(item: MenuItem, roles: Role[]) {
    setBusyKey(item.key);
    setError(null);
    setMessage(null);
    const ok = await patchRoles(item.key, roles);
    if (ok) setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, roles } : i)));
    setBusyKey(null);
  }

  async function handleCascade(item: MenuItem) {
    const descendantKeys = getAllDescendantKeys(item.key, byParent);
    if (descendantKeys.length === 0) return;
    setBusyKey(item.key);
    setError(null);
    setMessage(null);
    for (const key of descendantKeys) {
      await patchRoles(key, item.roles);
    }
    setItems((prev) => prev.map((i) => (descendantKeys.includes(i.key) ? { ...i, roles: item.roles } : i)));
    setMessage(`Applied "${item.label}"'s access to ${descendantKeys.length} submenu item(s) below it.`);
    setBusyKey(null);
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function summaryText(roles: Role[]): string {
    if (roles.length === 0) return "None";
    if (roles.length === ALL_ROLES.length) return "All";
    return roles.map((r) => ROLE_LABELS[r]).join(", ");
  }

  function renderNode(item: MenuItem, depth: number): React.ReactNode {
    const children = byParent.get(item.key) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedKeys.has(item.key);
    const isBusy = busyKey === item.key;
    const isComboboxOpen = openComboboxKey === item.key;

    return (
      <div key={item.key}>
        <div className="flex items-center gap-2 py-2 border-b border-neutral-100" style={{ paddingLeft: depth * 20 }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(item.key)}
              aria-label={isExpanded ? "Collapse" : "Expand"}
              className="w-6 h-6 shrink-0 flex items-center justify-center border border-neutral-300 rounded text-neutral-600 hover:bg-neutral-50"
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="w-6 shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{item.label}</div>
            <div className="text-neutral-400 text-xs truncate">{item.href}</div>
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setOpenComboboxKey(isComboboxOpen ? null : item.key)}
              disabled={isBusy}
              className="border border-neutral-300 rounded px-2 py-1 text-xs w-32 text-left flex items-center justify-between gap-1 disabled:opacity-50 bg-surface-raised"
            >
              <span className="truncate">{summaryText(item.roles)}</span>
              <span className="text-neutral-400 shrink-0">▾</span>
            </button>

            {isComboboxOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setOpenComboboxKey(null)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-surface-raised border border-neutral-300 rounded shadow-lg p-2 flex flex-col gap-1.5 w-32">
                  {ALL_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.roles.includes(role)}
                        onChange={() =>
                          handleRolesChange(
                            item,
                            item.roles.includes(role) ? item.roles.filter((r) => r !== role) : [...item.roles, role]
                          )
                        }
                        className="w-4 h-4"
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {hasChildren && (
            <button
              type="button"
              onClick={() => handleCascade(item)}
              disabled={isBusy}
              title={`Apply "${summaryText(item.roles)}" to every submenu under ${item.label}`}
              className="text-xs text-accent underline decoration-dotted whitespace-nowrap disabled:opacity-50 shrink-0"
            >
              Apply to submenus
            </button>
          )}
        </div>

        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const topLevel = byParent.get(null) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Menu Access</h1>
      <p className="text-neutral-500 text-sm">
        Shown as a tree, the same shape as the app&apos;s own navigation - a main menu item, then tap + to reveal its
        submenus. Setting a role here for a menu item only controls whether that button is visible to that role -
        it&apos;s not the page&apos;s own access check, so removing a role doesn&apos;t loosen or tighten what that
        role can actually reach if they already know the URL. &quot;Apply to submenus&quot; copies a main item&apos;s
        current access down to everything nested under it in one step.
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {message && <p className="text-green-700 text-sm">{message}</p>}

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : (
        <div className="border border-neutral-200 rounded overflow-x-auto">
          {topLevel.map((item) => renderNode(item, 0))}
        </div>
      )}
    </div>
  );
}
