import Link from "next/link";
import type { ReactNode } from "react";
import { Crest } from "@/components/brand/Crest";
import { canSwitchCentre, getMyCentres } from "@/lib/auth/centres";
import { ROLE_LABELS, navFor, primaryRole } from "@/lib/auth/roles";
import type { Session } from "@/lib/auth/session";
import { HowToPilot } from "@/components/guides/HowToPilot";
import { pilotFor } from "@/lib/guides/pilot";
import { loadMyPageOpen } from "@/lib/profile/server";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu } from "./AccountMenu";
import { BottomTabs, TopNav } from "./NavLinks";

export function displayName(person: Session["person"]) {
  return person.preferredName ?? person.fullName ?? person.email.split("@")[0];
}

export async function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const owner = session.god === "open";
  const items = navFor(session.roles, owner);
  // Only staff with a role in more than one centre, and only once the church has switched this on, ever see a choice
  const mine = session.roles.some((r) => r !== "member") ? await getMyCentres() : null;
  const centres = canSwitchCentre(mine) ? { current: mine.current?.id ?? null, list: mine.centres.filter((c) => c.active) } : null;
  const name = session.person.fullName ?? displayName(session.person);
  const pilot = pilotFor(session.roles, items);
  // The link to My page appears only while My page is open for this person (the owner has no member page)
  const myPage = owner ? false : await loadMyPageOpen(await createClient());

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
          <Link href="/home" className="press flex min-h-10 w-fit items-center gap-3 rounded-lg">
            <Crest size={26} />
            <span className="t-heading" style={{ fontStretch: "88%", letterSpacing: "-0.02em" }}>
              United Tribes
            </span>
          </Link>
          <TopNav items={items} />
          <div className="col-start-3 flex items-center justify-end gap-2">
            <AccountMenu
              name={name}
              email={session.person.email}
              roleLabel={owner ? "Platform owner" : ROLE_LABELS[primaryRole(session.roles)]}
              centres={centres}
              myPage={myPage}
            />
          </div>
        </div>
      </header>

      <main id="content" className={`mx-auto max-w-5xl px-5 py-7 sm:px-8 sm:py-12 ${items.length > 1 ? "pb-32 lg:pb-14" : ""}`}>
        {children}
      </main>

      <BottomTabs items={items} />
      {/* The button that shows anyone how to use the app: on every screen, for every role */}
      <HowToPilot data={pilot} tabs={items.length > 1} />
    </div>
  );
}
