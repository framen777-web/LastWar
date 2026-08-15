import { requireRole } from "@/lib/auth/dal";

export default async function AllianceGraphsPage() {
  await requireRole(["ADMIN", "LEADER"]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Graphs</h1>
      <p className="text-neutral-500 text-sm">Coming soon.</p>
    </div>
  );
}
