import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const params = await searchParams;
  const submitted = params.submitted !== undefined;

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">Forgot password</h1>

      {submitted ? (
        <p className="text-sm text-neutral-600">
          If that account exists and has a recovery email on file, a reset link is on its way. Check your inbox
          (and spam folder). No email on file? Ask an admin to reset your password from Setup → Users instead.
        </p>
      ) : (
        <form action={requestPasswordReset} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium">Commander name</label>
            <input id="name" name="name" type="text" required autoFocus className="border border-neutral-300 rounded px-3 py-2" />
          </div>
          <button type="submit" className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
            Send reset link
          </button>
        </form>
      )}
    </div>
  );
}
