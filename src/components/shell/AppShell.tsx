import Link from "next/link";
import type { ReactNode } from "react";
import { Crest } from "@/components/brand/Crest";
import { ROLE_LABELS, navFor, primaryRole } from "@/lib/auth/roles";
import type { Session } from "@/lib/auth/session";
import { AccountMenu } from "./AccountMenu";
import { BottomTabs, TopNav } from "./NavLinks";

export function displayName(person: Session["person"]) {
  return person.preferredName ?? person.fullName ?? person.email.split("@")[0];
}

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const items = navFor(session.roles);
  const name = session.person.fullName ?? displayName(session.person);

  return (
    <div className="min-h-dvh bg-page">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-page"
      >
        Skip to content
      </a>

      <header className="glass safe-top sticky top-0 z-30 border-b border-line">
        <div className="mx-auto grid h-16 max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 sm:px-8">
          <Link href="/home" className="press flex w-fit items-center gap-3 rounded-lg">
            <Crest size={26} />
            <span className="t-heading" style={{ fontStretch: "88%", letterSpacing: "-0.02em" }}>
              United Tribes
            </span>
          </Link>
          <TopNav items={items} />
          <div className="col-start-3 flex justify-end">
            <AccountMenu
              name={name}
              email={session.person.email}
              roleLabel={ROLE_LABELS[primaryRole(session.roles)]}
            />
          </div>
        </div>
      </header>

      <main id="content" className={`mx-auto max-w-5xl px-5 py-7 sm:px-8 sm:py-12 ${items.length > 1 ? "pb-32 lg:pb-14" : ""}`}>
        {children}
      </main>

      <BottomTabs items={items} />
    </div>
  );
}
