import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell, displayName } from "@/components/shell/AppShell";
import { Library, type ShelfView } from "@/components/guides/Library";
import { PublicFrame } from "@/components/guides/PublicFrame";
import { getSession } from "@/lib/auth/session";
import { shelvesFor } from "@/lib/guides/access";
import { GUIDES } from "@/lib/guides/catalogue";
import { cardOf, type CardView } from "@/lib/guides/view";

export const metadata: Metadata = { title: "How-to guides", description: "Short guides with a picture for every step." };

/** The Tribe Card guide was made first and lives at its own address, which has already been shared. It is listed here, and opens there. */
const TRIBE_CARD_GUIDE: CardView = {
  slug: "tribe-card",
  code: "L0",
  title: "Fill in your Tribe Card, and your first 21 days",
  lede: "Ten steps to fill in your Tribe Card, then what to do in your first 21 days as a leader.",
  forWho: "For tribe leaders",
  minutes: 12,
  steps: 10,
  cover: null,
  href: "/tutorial",
  search: "l0 tribe card first 21 days leader fill in card",
};

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
