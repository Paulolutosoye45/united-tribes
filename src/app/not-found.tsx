import Link from "next/link";
import { Crest } from "@/components/brand/Crest";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="flex max-w-sm flex-col items-start gap-5">
        <Crest size={56} />
        <h1 className="t-title">We can&apos;t find that page</h1>
        <p className="t-body text-soft">The link may be old, or the page may have moved.</p>
        <Link
          href="/home"
          className="press inline-flex h-12 items-center rounded-[var(--radius-control)] bg-flame px-5 font-semibold text-on-flame"
        >
          Go to Home
        </Link>
      </div>
    </main>
  );
}
