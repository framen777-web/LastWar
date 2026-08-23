"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/auth/actions";
import { useNavigationBlocker } from "@/components/NavigationBlocker";
import { APP_VERSION } from "@/lib/version";

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

type NavUser = { name: string; role: "ADMIN" | "LEADER" | "MEMBER" } | null;

export function NavHeader({ user }: { user: NavUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";
  const isLoginish = pathname === "/login" || pathname === "/setup-admin";
  const { isBlocked, blockMessage } = useNavigationBlocker();

  // Covers in-app navigation only - see components/NavigationBlocker.tsx for why the
  // browser's own physical back/forward button can't be intercepted the same way.
  function guardedNavigate(e: { preventDefault: () => void }) {
    if (isBlocked && !window.confirm(blockMessage)) e.preventDefault();
  }

  function handleBack() {
    if (isBlocked && !window.confirm(blockMessage)) return;
    router.back();
  }

  return (
    <header className="border-b border-neutral-200 bg-surface-raised sticky top-0 z-10">
      <div className="flex items-center justify-between px-2 py-2 max-w-5xl mx-auto">
        <div className="w-10">
          {!isHome && (
            <button
              onClick={handleBack}
              aria-label="Back"
              className="p-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded"
            >
              <BackIcon />
            </button>
          )}
        </div>
        <Link href="/" onNavigate={guardedNavigate} className="flex flex-col items-center leading-tight">
          <span className="app-title font-semibold text-sm">Alliance Stats</span>
          <span className="text-[10px] text-neutral-400">v{APP_VERSION}</span>
        </Link>
        <div className="w-10 flex justify-end">
          {!isHome && (
            <Link
              href="/"
              onNavigate={guardedNavigate}
              aria-label="Home"
              className="p-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded"
            >
              <HomeIcon />
            </Link>
          )}
        </div>
      </div>
      {user && !isLoginish && (
        <div className="flex items-center justify-between px-3 pb-2 max-w-5xl mx-auto text-xs">
          <Link href="/account" className="text-nav-link hover:underline">
            {user.name} · {user.role}
          </Link>
          <form action={logout}>
            <button type="submit" className="text-nav-link underline">
              Log out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
