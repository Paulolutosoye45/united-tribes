import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DeskLeaders } from "@/components/god/DeskLeaders";
import { DeskProposals, type StartValues } from "@/components/god/DeskProposals";
import { DeskWaiting } from "@/components/god/DeskWaiting";
import { cn } from "@/lib/cn";
import {
  DESK_WORDS as W,
  PAGE_SIZE,
  SLOT_KEYS,
  TABS,
  isChip,
  isDeskId,
  isPool,
  isTab,
  pageOf,
  slotWord,
  type Chip,
  type Pool,
  type Tab,
} from "@/lib/god/desk";
import { loadDeskChoices, loadDeskClusters, loadDeskGroups, loadDeskLeaders, loadDeskOverview, loadDeskWaiting } from "@/lib/god/desk-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader Desk" };

type SearchParams = Promise<{ tab?: string; chip?: string; pool?: string; page?: string; start?: string }>;

export default async function LeaderDeskPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const tab: Tab = isTab(sp.tab) ? sp.tab : "waiting";
  const chip: Chip | null = isChip(sp.chip) ? sp.chip : null;
  const pool: Pool = isPool(sp.pool) ? sp.pool : "ready";
  const pageNo = pageOf(sp.page);
  const supabase = await createClient();
  const overview = await loadDeskOverview(supabase);

  const header = (
    <header className="flex flex-col gap-2">
      <h1 className="t-title">{W.title}</h1>
      <p className="t-body measure text-soft">{W.intro}</p>
    </header>
  );

  if (!overview) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="card t-body flex flex-col gap-2 p-5 text-soft" data-testid="desk-off">
          <span>{W.off}</span>
          <Link href="/god/features" className="underline">
            Open Features
          </Link>
        </p>
      </div>
    );
  }

  const nav = (
    <nav aria-label="Leader Desk" className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/god/leader-desk?tab=${t.key}`}
          aria-current={tab === t.key ? "page" : undefined}
          className={cn("press rounded-full px-4 py-2 text-[0.92rem] font-medium", tab === t.key ? "bg-ink text-page" : "border border-line text-soft hover:text-ink")}
        >
          {t.label}
          <span className="ml-2 tabular-nums">{t.key === "waiting" ? overview.waiting.all : t.key === "proposals" ? overview.drafts : overview.leaders.ready}</span>
        </Link>
      ))}
    </nav>
  );

  if (!overview.season) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="card t-body p-5 text-soft">{W.noSeason}</p>
      </div>
    );
  }

  let body: React.ReactNode;
  if (tab === "waiting") {
    const page = await loadDeskWaiting(supabase, chip, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE);
    body = <DeskWaiting overview={overview} page={page} chip={chip} pageNo={pageNo} />;
  } else if (tab === "leaders") {
    const page = await loadDeskLeaders(supabase, pool, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE);
    body = <DeskLeaders overview={overview} page={page} pool={pool} pageNo={pageNo} />;
  } else {
    const [groups, clusters, choices] = await Promise.all([loadDeskGroups(supabase), loadDeskClusters(supabase), loadDeskChoices(supabase)]);
    // "Start a draft" from a line in the list opens the form with that line's answers filled in
    let start: StartValues | null = null;
    const [track, slot, mode, type] = (sp.start ?? "").split(",");
    const trackName = choices.tracks.find((t) => t.id === track)?.name;
    if (isDeskId(track) && trackName && SLOT_KEYS.includes(slot) && (mode === "online" || mode === "in_person") && (type === "mixed" || type === "women" || type === "men")) {
      start = { track, slot, mode, type, name: `${trackName}, ${slotWord(slot)}` };
    }
    body = <DeskProposals overview={overview} groups={groups} clusters={clusters} choices={choices} start={start} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <p className="t-small text-soft">
        {overview.season.name}
        {overview.season.week > 0 && overview.season.week <= overview.season.weeks ? `, week ${overview.season.week} of ${overview.season.weeks}` : ""}
      </p>
      {overview.mode === "rehearsal" ? (
        <p className="card t-small border-l-4 border-l-gold p-4" data-testid="desk-rehearsal">
          {W.rehearsalNote}
        </p>
      ) : null}
      {nav}
      {body}
    </div>
  );
}
