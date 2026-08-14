import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionPayload } from "./session";
import { effectiveRole, type Role } from "./roles";

export type CurrentUser = {
  id: number;
  name: string;
  allianceRank: string | null;
  role: Role;
  theme: string;
};

/** Cached per request - safe to call from multiple components in one render pass. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const payload = await getSessionPayload();
  if (!payload) return null;

  const member = await prisma.member.findUnique({ where: { id: payload.memberId } });
  if (!member || !member.isActive) return null;

  return {
    id: member.id,
    name: member.name,
    allianceRank: member.allianceRank,
    role: effectiveRole(member),
    theme: member.theme,
  };
});

/** For Server Components/pages. Redirects to /login (no session) or / (wrong role). */
export async function requireRole(allowed: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!allowed.includes(user.role)) redirect("/");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  return requireRole(["ADMIN"]);
}

/** For Route Handlers, which can't call redirect(). Returns a 401/403 response to bail with. */
export async function requireAdminApi(): Promise<{ user: CurrentUser } | { error: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  return { user };
}

/** Same shape as requireAdminApi, but for self-service routes any authenticated role can use. */
export async function requireAuthApi(): Promise<{ user: CurrentUser } | { error: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  return { user };
}
