import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { setupAdmin } from "./actions";
import { getMinPasswordLength } from "@/lib/settings";

export default async function SetupAdminPage({ searchParams }: PageProps<"/setup-admin">) {
  const adminCount = await prisma.member.count({ where: { role: "ADMIN" } });
  if (adminCount > 0) redirect("/login");

  const params = await searchParams;
  const hasError = params.error !== undefined;

  const members = await prisma.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const minPasswordLength = await getMinPasswordLength();

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">Create the first admin</h1>
      <p className="text-neutral-500 text-sm">
        No admin account exists yet. Pick your Commander from the roster and set a password to become the first
        administrator.
      </p>

      <form action={setupAdmin} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="memberId" className="text-sm font-medium">
            Commander
          </label>
          <select id="memberId" name="memberId" required className="border border-neutral-300 rounded px-3 py-2">
            <option value="">Select...</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={minPasswordLength}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          <p className="text-neutral-500 text-xs">At least {minPasswordLength} characters.</p>
        </div>

        {hasError && (
          <p className="text-red-600 text-sm">Pick a commander and a {minPasswordLength}+ character password.</p>
        )}

        <button type="submit" className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
          Create admin
        </button>
      </form>
    </div>
  );
}
