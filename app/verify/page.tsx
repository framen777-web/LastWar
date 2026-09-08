import { requireMenuAccess } from "@/lib/menuAccess";
import { VerifyClient } from "./VerifyClient";

export default async function VerifyPage() {
  await requireMenuAccess("uploads-verify-imports");
  return <VerifyClient />;
}
