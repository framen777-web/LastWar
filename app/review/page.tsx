import { requireAdmin } from "@/lib/auth/dal";
import { ReviewClient } from "./ReviewClient";

export default async function ReviewPage() {
  await requireAdmin();
  return <ReviewClient />;
}
