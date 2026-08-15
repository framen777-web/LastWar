import { requireMenuAccess } from "@/lib/menuAccess";

export default async function AllianceGraphsPage() {
  await requireMenuAccess("alliance-graphs");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Graphs</h1>
      <p className="text-neutral-500 text-sm">Coming soon.</p>
    </div>
  );
}
