import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

// Season Extras screenshots that classification couldn't confidently commit are logged here
// (see lib/pipeline/runSeasonExtra.ts's logResult) but - unlike the weekly pipeline's
// RawExtraction/app/raw review flow - never surfaced anywhere, so they'd otherwise vanish
// permanently the moment the admin gets pulled away without re-uploading. This just lists them
// so nothing goes silently missing.
export async function GET(_request: Request, ctx: RouteContext<"/api/seasons/[id]/upload-extras/needs-review">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const rows = await prisma.rawSeasonExtraction.findMany({
    where: { seasonId: Number(id), status: "needs_review" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ rows });
}
