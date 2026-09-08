import { requireMenuAccess } from "@/lib/menuAccess";
import { VerifyDetailClient } from "./VerifyDetailClient";

export default async function VerifyDetailPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;
  return <VerifyDetailClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
