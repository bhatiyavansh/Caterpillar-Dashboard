import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-6xl font-black text-cat-500">404</p>
      <h1 className="text-xl font-bold text-zinc-100">That screen is not on this machine</h1>
      <p className="max-w-md text-sm text-muted">
        The page you followed does not exist. Return to the fleet dashboard or open the in-cab application.
      </p>
      <div className="mt-2 flex gap-3">
        <Link href="/dashboard" className="rounded bg-cat-500 px-5 py-3 text-sm font-bold text-ink-950">
          Fleet dashboard
        </Link>
        <Link href="/machine" className="rounded border border-white/15 px-5 py-3 text-sm font-bold text-zinc-200">
          Machine application
        </Link>
      </div>
    </main>
  );
}
