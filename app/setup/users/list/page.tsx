import { requireMenuAccess } from "@/lib/menuAccess";
import { UsersClient } from "./UsersClient";

export default async function UsersListPage() {
  await requireMenuAccess("users-list");
  return <UsersClient />;
}
