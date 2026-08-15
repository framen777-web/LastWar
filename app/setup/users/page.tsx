import { requireMenuAccess } from "@/lib/menuAccess";
import { UsersClient } from "./UsersClient";

export default async function UsersPage() {
  await requireMenuAccess("settings-users");
  return <UsersClient />;
}
