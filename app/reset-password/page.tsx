import { prisma } from "@/lib/db";
import { decodeResetToken, verifyResetToken } from "@/lib/auth/resetToken";
import { getMinPasswordLength } from "@/lib/settings";
import { resetPassword } from "./actions";

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const hasError = params.error !== undefined;

  const memberId = token ? await decodeResetToken(token) : null;
  const member = memberId ? await prisma.member.findUnique({ where: { id: memberId } }) : null;
  const valid = !!member && member.isActive && (await verifyResetToken(token, member));

  if (!member || !valid) {
    return (
      <div className="flex flex-col gap-4 max-w-sm mx-auto">
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="text-sm text-red-600">
          This link has expired or has already been used. Request a new one from the{" "}
          <a href="/forgot-password" className="text-accent underline">forgot password</a> page.
        </p>
      </div>
    );
  }

  const minPasswordLength = await getMinPasswordLength();

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <p className="text-sm text-neutral-500">for {member.name}</p>

      <form action={resetPassword} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">New password</label>
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
        {hasError && <p className="text-red-600 text-sm">Something went wrong - try requesting a new link.</p>}
        <button type="submit" className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
          Set password
        </button>
      </form>
    </div>
  );
}
