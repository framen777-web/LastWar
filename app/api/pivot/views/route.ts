import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";

// Any authenticated role can save a view - it's a personal convenience scoped to the creator
// (see PivotView.creatorId), not an admin-only action. Saving under a name that already exists
// for this creator overwrites it in place (upsert), matching "Save this view as..." reading as
// "save/update", not "create a new one or fail."
export async function POST(request: Request) {
  const auth = await requireAuthApi();
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as { name?: string; config?: string };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const config = typeof body.config === "string" ? body.config : "";
  if (!name || !config) {
    return NextResponse.json({ error: "name and config are required." }, { status: 400 });
  }

  try {
    const view = await prisma.pivotView.upsert({
      where: { creatorId_name: { creatorId: auth.user.id, name } },
      update: { config },
      create: { creatorId: auth.user.id, name, config },
    });
    return NextResponse.json({ view });
  } catch {
    return NextResponse.json({ error: "Could not save this view." }, { status: 500 });
  }
}
