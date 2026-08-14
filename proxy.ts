import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/auth/roles";

type Classification = "public" | "any-authenticated" | "admin-leader" | "admin-only";

// Ordered most-specific-first; first prefix match wins. This is the *optimistic* check -
// every page/route also enforces its own role requirement (see lib/auth/dal.ts), which is
// the actual access control. Unrecognized paths fail closed to admin-only.
const RULES: { prefix: string; classification: Classification }[] = [
  { prefix: "/login", classification: "public" },
  { prefix: "/setup-admin", classification: "public" },
  { prefix: "/api/auth", classification: "public" },
  { prefix: "/account", classification: "any-authenticated" },
  { prefix: "/api/account", classification: "any-authenticated" },
  { prefix: "/dashboard/multi", classification: "admin-leader" },
  { prefix: "/dashboard", classification: "any-authenticated" },
  { prefix: "/reports", classification: "admin-leader" },
  { prefix: "/new-information", classification: "admin-leader" },
  { prefix: "/", classification: "any-authenticated" },
];

function classifyPath(pathname: string): Classification {
  for (const rule of RULES) {
    if (rule.prefix === "/") {
      if (pathname === "/") return rule.classification;
      continue;
    }
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule.classification;
    }
  }
  return "admin-only";
}

async function noAdminExists(): Promise<boolean> {
  const count = await prisma.member.count({ where: { role: "ADMIN" } });
  return count === 0;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const classification = classifyPath(pathname);
  const isApi = pathname.startsWith("/api/");

  if (classification === "public") return NextResponse.next();

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

  const role = effectiveRole(member);
  const allowed =
    classification === "any-authenticated" ||
    (classification === "admin-leader" && (role === "ADMIN" || role === "LEADER")) ||
    (classification === "admin-only" && role === "ADMIN");

  if (!allowed) {
    if (isApi) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
