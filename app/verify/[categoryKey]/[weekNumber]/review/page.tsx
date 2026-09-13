import { requireMenuAccess } from "@/lib/menuAccess";
import { ReviewIssuesClient } from "./ReviewIssuesClient";

export default async function SquadReviewPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]/review">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;
  return <ReviewIssuesClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
