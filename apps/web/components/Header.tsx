import Link from "next/link";
import { signOut } from "@/app/login/actions";

export function Header({ crumb }: { crumb?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-4">
        <Link href="/" className="font-display text-lg font-semibold tracking-[0.12em] uppercase">
          Shoebox Studio
        </Link>
        {crumb && (
          <>
            <span className="text-line">/</span>
            <span className="truncate text-muted">{crumb}</span>
          </>
        )}
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-1.5 text-muted hover:bg-raised hover:text-text">
            Board
          </Link>
          <Link href="/shows" className="rounded-md px-3 py-1.5 text-muted hover:bg-raised hover:text-text">
            Shows
          </Link>
        </nav>
        <form action={signOut}>
          <button className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-raised hover:text-text">Sign out</button>
        </form>
      </div>
    </header>
  );
}
