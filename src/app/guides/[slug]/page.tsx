import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GuideReader } from "@/components/guides/GuideReader";
import { GuideStatic } from "@/components/guides/GuideStatic";
import { PublicFrame } from "@/components/guides/PublicFrame";
import { IconLock } from "@/components/guides/icons";
import { AppShell } from "@/components/shell/AppShell";
import { buttonClasses } from "@/components/ui/Button";
import { getSession } from "@/lib/auth/session";
import { canOpen, doorFor } from "@/lib/guides/access";
import { GUIDES, guideBySlug } from "@/lib/guides/catalogue";
import { viewOf } from "@/lib/guides/view";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string }> };

/** A guide's title is shown in the tab only to someone who may open it. */
export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return { title: "How-to guide" };
  const session = await getSession();
  return { title: canOpen(guide, session?.roles ?? null) ? guide.title : "How-to guide" };
}

export default async function GuidePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { view } = await searchParams;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const session = await getSession();
  if (session?.god === "locked") redirect("/god/unlock");
  const roles = session?.roles ?? null;
  const door = doorFor(guide, roles);

  // Not signed in, and the guide is not open to everyone: sign in, then come straight back
  if (door === "sign-in") redirect(`/sign-in?next=${encodeURIComponent(`/guides/${slug}`)}`);

  // Signed in, but this guide is for another role. It says whose it is, politely, and shows nothing of what is in it.
  if (door === "forbidden") {
    const body = (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-5 py-10">
        <span className="grid size-12 place-items-center rounded-full bg-surface text-soft">
          <IconLock />
        </span>
        <h1 className="t-title">This guide is for someone else.</h1>
        <p className="t-body text-soft">
          {guide.forWho}. It opens for people who hold that role. If it should be yours, ask the church office.
        </p>
        <Link href="/guides" className={buttonClasses({ className: "px-8" })}>
          <span className="relative">See the guides for you</span>
        </Link>
      </div>
    );
    return session ? <AppShell session={session}>{body}</AppShell> : <PublicFrame signInTo={`/guides/${slug}`}>{body}</PublicFrame>;
  }

  // The guides to offer afterwards are only ones this person may open
  const next = (guide.next ?? []).map((s) => GUIDES.find((g) => g.slug === s)).filter((g) => g && canOpen(g, roles));
  const gv = viewOf(guide, next as typeof GUIDES);
  return view === "all" ? <GuideStatic guide={gv} /> : <GuideReader guide={gv} />;
}
