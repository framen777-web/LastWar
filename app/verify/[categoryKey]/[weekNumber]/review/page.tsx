import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { hasHqReviewStep } from "@/lib/verify/service";
import { ReviewIssuesClient } from "./ReviewIssuesClient";
import { HqReviewClient } from "./HqReviewClient";

export default async function CategoryReviewPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]/review">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });

  if (category && hasHqReviewStep(category)) {
    return <HqReviewClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
  }
  return <ReviewIssuesClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
