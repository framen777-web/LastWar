import { Suspense } from "react";
import { requireMenuAccess } from "@/lib/menuAccess";
import { MergeClient } from "./MergeClient";

export default async function MergePage() {
  await requireMenuAccess("users-merge");
  return (
    <Suspense fallback={<p className="text-neutral-500 text-sm">Loading…</p>}>
      <MergeClient />
    </Suspense>
  );
}
