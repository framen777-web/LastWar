"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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

export function NavHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  return (
    <header className="border-b border-neutral-200 bg-white sticky top-0 z-10">
      <div className="flex items-center justify-between px-2 py-2 max-w-5xl mx-auto">
        <div className="w-10">
          {!isHome && (
            <button
              onClick={() => router.back()}
              aria-label="Back"
              className="p-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded"
            >
              <BackIcon />
            </button>
          )}
        </div>
        <Link href="/" className="font-semibold text-sm">
          Alliance Stats
        </Link>
        <div className="w-10 flex justify-end">
          {!isHome && (
            <Link
              href="/"
              aria-label="Home"
              className="p-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded"
            >
              <HomeIcon />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
