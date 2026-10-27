import Link from "next/link";
import type { ReactNode } from "react";
import { Crest } from "@/components/brand/Crest";

/** The frame round a guides page for someone who is not signed in: the name, a way to sign in, and the page. */
export function PublicFrame({ children, signInTo }: { children: ReactNode; signInTo: string }) {
  return (
    <div className="min-h-dvh bg-page">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-page">
        Skip to content
      </a>
      <header className="glass safe-top sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/guides" className="press flex min-h-10 items-center gap-3 rounded-lg">
            <Crest size={26} />
            <span className="t-heading" style={{ fontStretch: "88%", letterSpacing: "-0.02em" }}>
              United Tribes
            </span>
          </Link>
          <Link href={`/sign-in?next=${encodeURIComponent(signInTo)}`} className="press inline-flex h-10 items-center rounded-xl border border-line bg-raised px-4 text-[0.92rem] font-semibold">
            Sign in
          </Link>
        </div>
      </header>
      <main id="content" className="mx-auto max-w-5xl px-5 py-7 pb-20 sm:px-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
