import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell, displayName } from "@/components/shell/AppShell";
import { Library, type ShelfView } from "@/components/guides/Library";
import { PublicFrame } from "@/components/guides/PublicFrame";
import { getSession } from "@/lib/auth/session";
import { shelvesFor } from "@/lib/guides/access";
import { GUIDES } from "@/lib/guides/catalogue";
import { TRIBE_CARD_GUIDE } from "@/lib/guides/tribe-card";
import { cardOf } from "@/lib/guides/view";

export const metadata: Metadata = { title: "How-to guides", description: "Short guides with a picture for every step." };

export default async function GuidesPage() {
  const session = await getSession();
  // The owner has no menu, and no powers, until the passphrase
  if (session?.god === "locked") redirect("/god/unlock");

  const shelves: ShelfView[] = shelvesFor(GUIDES, session?.roles ?? null).map((s) => ({
    key: s.key,
    title: s.title,
    blurb: s.blurb,
    cards: s.guides.map(cardOf),
  }));
  // The Tribe Card guide sits first on the leaders' shelf
  if (session?.roles.some((r) => r === "leader" || r === "assistant_leader")) {
    const shelf = shelves.find((s) => s.key === "leader");
    if (shelf) shelf.cards.unshift(TRIBE_CARD_GUIDE);
    else shelves.unshift({ key: "leader", title: "For tribe leaders", blurb: "From the first step of applying to running your tribe's season.", cards: [TRIBE_CARD_GUIDE] });
  }

  const page = <Library shelves={shelves} signedIn={Boolean(session)} greeting={session ? displayName(session.person) : null} />;
  return session ? <AppShell session={session}>{page}</AppShell> : <PublicFrame signInTo="/guides">{page}</PublicFrame>;
}
