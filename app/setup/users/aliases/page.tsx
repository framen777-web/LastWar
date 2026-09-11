import { requireMenuAccess } from "@/lib/menuAccess";
import { AliasesClient } from "./AliasesClient";

export default async function AliasesPage() {
  await requireMenuAccess("users-aliases");
  return <AliasesClient />;
}
