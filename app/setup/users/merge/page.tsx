import { requireMenuAccess } from "@/lib/menuAccess";
import { MergeClient } from "./MergeClient";

export default async function MergePage() {
  await requireMenuAccess("users-merge");
  return <MergeClient />;
}
