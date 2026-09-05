import { login } from "./actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const hasError = params.error !== undefined;

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">Log in</h1>

      <form action={login} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            Commander name, alias, email, or phone
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoFocus
            className="border border-neutral-300 rounded px-3 py-2"
          />
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
            className="border border-neutral-300 rounded px-3 py-2"
          />
        </div>

        <a href="/forgot-password" className="text-sm text-accent underline self-end">
          Forgot your password?
        </a>

        {hasError && <p className="text-red-600 text-sm">Invalid name or password.</p>}

        <button type="submit" className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
          Log in
        </button>
      </form>
    </div>
  );
}
