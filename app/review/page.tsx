import { requireMenuAccess } from "@/lib/menuAccess";
import { ReviewClient } from "./ReviewClient";

export default async function ReviewPage() {
  await requireMenuAccess("uploads-flagged-errors");
  return <ReviewClient />;
}
