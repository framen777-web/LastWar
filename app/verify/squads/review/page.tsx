import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { ReviewIssuesClient } from "@/app/verify/[categoryKey]/[weekNumber]/review/ReviewIssuesClient";

// Fixed entry point for the "Squads Review" nav button - there's no "pick a week" UI here,
// so it just finds the most recent pending Squads batch and reviews that. See
// app/verify/[categoryKey]/[weekNumber]/review/page.tsx for the generic per-batch version
// reached from VerifyDetailClient's Commit flow.
export default async function SquadsReviewLandingPage() {
  await requireMenuAccess("uploads-squads-review");

  const batch = await prisma.importBatch.findFirst({
    where: { categoryKey: "squads", status: "pending" },
    orderBy: { weekNumber: "desc" },
  });

  if (!batch) {
    return <p className="text-neutral-500 text-sm">Nothing to review right now - no pending Squads import.</p>;
  }

  return <ReviewIssuesClient categoryKey="squads" weekNumber={batch.weekNumber} />;
}
