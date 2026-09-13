import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { hasSquadReviewStep } from "@/lib/verify/service";
import { VerifyDetailClient } from "./VerifyDetailClient";

export default async function VerifyDetailPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;

  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  const hasReviewStep = category ? hasSquadReviewStep(category) : false;

  return <VerifyDetailClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} hasReviewStep={hasReviewStep} />;
}
