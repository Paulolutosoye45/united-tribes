import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Crest } from "@/components/brand/Crest";
import { UnlockForm } from "@/components/god/UnlockForm";
import { Button } from "@/components/ui/Button";
import { requireSession } from "@/lib/auth/session";
import { signOut } from "@/app/(app)/actions";

export const metadata: Metadata = { title: "Owner access", robots: { index: false, follow: false } };

type SearchParams = Promise<{ next?: string }>;

/**
 * The unlock step for the platform owner. For everyone else this page does not exist: the same 404 as any address the
 * platform does not have, whether or not they are signed in as someone who could not unlock.
 */
export default async function UnlockPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession("/god/unlock");
  if (session.god === "none") notFound();
  const { next } = await searchParams;
  if (session.god === "open") redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/god");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-12">
      <div className="flex flex-col items-center gap-4 text-center">
        <Crest size={44} />
        <h1 className="t-title">Owner access</h1>
        <p className="t-body text-soft">
          Signing in is the first step. Give your passphrase to switch on your access for this sign-in. It ends after four hours, or when you lock it.
        </p>
      </div>
      <div className="card p-6 sm:p-8">
        <UnlockForm next={next ?? "/god"} />
      </div>
      <form action={signOut} className="text-center">
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  );
}
