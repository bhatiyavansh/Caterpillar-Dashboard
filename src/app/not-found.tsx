import Link from "next/link";
import { LayoutDashboard, Truck } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono text-5xl font-black text-cat-500">404</p>
      <h1 className="text-lg font-bold text-zinc-50">That screen is not on this machine</h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        The page you followed does not exist. The command centre has the live site; the cab has the
        machine you are operating.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Link
          href="/command"
          className="inline-flex h-10 items-center gap-2 rounded bg-cat-500 px-4 text-sm font-bold text-ink-950 transition-colors hover:bg-cat-400"
        >
          <LayoutDashboard className="size-4" aria-hidden />
          Command centre
        </Link>
        <Link
          href="/cab"
          className="inline-flex h-10 items-center gap-2 rounded border border-white/15 px-4 text-sm font-bold text-zinc-200 transition-colors hover:bg-white/5"
        >
          <Truck className="size-4" aria-hidden />
          Operator cab
        </Link>
      </div>
    </main>
  );
}
