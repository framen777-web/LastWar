import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/auth/session";

const PUBLIC_PREFIXES = ["/login", "/setup-admin", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function noAdminExists(): Promise<boolean> {
  const count = await prisma.member.count({ where: { role: "ADMIN" } });
  return count === 0;
}

// Authentication only ("is there a valid, active session") - not authorization. Which role
// can see which page is entirely owned by that page's own requireRole()/requireMenuAccess()
// call (lib/auth/dal.ts, lib/menuAccess.ts) and the Menu Access admin screen driving it -
// every page and API route already has its own real guard (verified directly: 36/36 pages,
// 31/31 API routes).
//
// This used to *also* classify every path into a hardcoded role table here, as a fast
// pre-filter before the real per-page check ran. That table never got updated as new routes
// were added (e.g. /dashboards, /setup/users, /conductor never made it in) and defaulted
// anything unrecognized to admin-only - so it silently redirected Members away from pages
// Menu Access said they should be able to see, before Menu Access or the page itself ever
// got a chance to run. Removed rather than kept in sync in two places at once.
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isPublic(pathname)) return NextResponse.next();

  const payload = await decrypt(request.cookies.get("session")?.value);

  if (!payload) {
    if (isApi) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (await noAdminExists()) return NextResponse.redirect(new URL("/setup-admin", request.url));
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const member = await prisma.member.findUnique({ where: { id: payload.memberId } });
  if (!member || !member.isActive) {
    if (isApi) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
