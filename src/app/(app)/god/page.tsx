import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Feed } from "@/components/god/Feed";
import { LiveRefresh } from "@/components/god/LiveRefresh";
import { EVERY_AREA } from "@/lib/auth/roles";
import { getOverview, loadFeed } from "@/lib/god/server";
import { getRequestsWaiting } from "@/lib/placement/server";
import { clock } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Console" };

type SearchParams = Promise<{ q?: string; before?: string }>;

function Stat({ label, value, note, href }: { label: string; value: string | number; note?: string; href?: string }) {
  const body = (
    <>
      <p className="t-small text-soft">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" style={{ letterSpacing: "-0.02em" }}>
        {value}
      </p>
      {note ? <p className="t-small mt-1 text-soft">{note}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="card press block p-5">
      {body}
    </Link>
  ) : (
    <div className="card p-5">{body}</div>
  );
}

export default async function ConsolePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { q, before } = await searchParams;
  const search = (q ?? "").trim().slice(0, 40) || null;
  const beforeId = before && /^\d{1,15}$/.test(before) ? Number(before) : null;
  const supabase = await createClient();
  const [o, events, requestsWaiting] = await Promise.all([getOverview(), loadFeed(supabase, { limit: 60, before: beforeId, search }), getRequestsWaiting()]);
  if (!o) return <p className="card t-body p-6 text-soft">The console could not load. Try again in a moment.</p>;

  const approved = o.tribes.approved ?? 0;
  const waiting = (o.tribes.submitted ?? 0) + (o.tribes.changes_requested ?? 0);
  const watch = o.attempts.probes_7d + o.attempts.wrong_7d;
  const feed = events ?? [];
  const last = feed.length > 0 ? feed[feed.length - 1].id : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Everything, as it happens</h1>
        <p className="t-body measure text-soft">
          You can open every page and change anything. Admin, review, care and the leader and member sides all open for you, and nobody below you can see that you are here.
        </p>
      </header>

      {requestsWaiting > 0 ? (
        <Link href="/god/placement" className="card press flex items-start gap-3 border-l-4 border-l-gold p-4" data-testid="requests-waiting-banner">
          <span className="t-body">
            <span className="font-semibold">{requestsWaiting === 1 ? "An admin is waiting for you." : `${requestsWaiting} admins are waiting for you.`}</span>{" "}
            {requestsWaiting === 1 ? "A request to place a member needs your answer." : "Requests to place members need your answer."} They lapse after 7 days.
          </span>
        </Link>
      ) : null}

      {watch > 0 ? (
        <Link href="/god/record" className="card press flex items-start gap-3 border-l-4 border-l-flame p-4">
          <span className="t-body">
            <span className="font-semibold">Look at your record.</span>{" "}
            {o.attempts.probes_7d > 0 ? `${o.attempts.probes_7d} ${o.attempts.probes_7d === 1 ? "time" : "times"} someone else tried the unlock this week. ` : ""}
            {o.attempts.wrong_7d > 0 ? `${o.attempts.wrong_7d} wrong ${o.attempts.wrong_7d === 1 ? "passphrase" : "passphrases"} this week.` : ""}
          </span>
        </Link>
      ) : null}

      <section aria-labelledby="now-heading" className="flex flex-col gap-4">
        <h2 id="now-heading" className="t-heading">
          The platform right now
        </h2>
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="People" value={o.people.total} note={`${o.people.today} new today`} href="/god/people" />
          <Stat label="Forms finished" value={o.people.with_profile} note={`${o.people.drafts} in progress`} />
          <Stat label="Tribes running" value={approved} note={waiting > 0 ? `${waiting} waiting on review` : "none waiting"} href="/god/tribes" />
          <Stat label="Seats filled" value={o.seats} />
          <Stat label="Care tasks open" value={o.care_open} href="/care" />
          <Stat label="Waiting for you" value={requestsWaiting} note={requestsWaiting > 0 ? "placement requests from Admin" : "no requests from Admin"} href="/god/placement" />
          <Stat
            label="Messages"
            value={o.messages.sent_today}
            note={`sent today · ${o.messages.queued} waiting · ${o.messages.failed_7d} failed this week`}
            href="/admin/messages"
          />
          <Stat label="Assistant" value={o.assistant.calls_24h} note={`calls in 24 hours · ${o.assistant.fallbacks_24h} fell back`} />
          <Stat label="Activity" value={o.activity.last_hour} note={`in the last hour · ${o.activity.last_day} today`} />
        </div>
        {o.erasure_open > 0 ? (
          <p className="t-body">
            {o.erasure_open} {o.erasure_open === 1 ? "person has" : "people have"} asked to be deleted.{" "}
            <Link href="/admin/privacy" className="underline">
              Open the requests
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="feed-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="feed-heading" className="t-heading">
            What everyone is doing
          </h2>
          <LiveRefresh />
        </div>
        <form method="get" className="flex gap-2" role="search">
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Filter by what happened, such as tribe or leader"
            aria-label="Filter the activity"
            className="h-12 w-full rounded-full border-[1.5px] border-line bg-raised px-5 text-base placeholder:text-soft/70 hover:border-soft focus:border-ink focus:outline-none"
          />
          <button type="submit" className="btn btn-quiet h-12 rounded-full px-5 font-medium">
            Filter
          </button>
        </form>
        <Feed events={feed} now={clock()} />
        {feed.length >= 60 && last ? (
          <Link href={`/god?${new URLSearchParams({ ...(search ? { q: search } : {}), before: String(last) }).toString()}`} className="t-body underline">
            Older activity
          </Link>
        ) : null}
        {beforeId ? (
          <Link href={search ? `/god?q=${encodeURIComponent(search)}` : "/god"} className="t-body underline">
            Back to the latest
          </Link>
        ) : null}
      </section>

      <section aria-labelledby="areas-heading" className="flex flex-col gap-4">
        <h2 id="areas-heading" className="t-heading">
          Open any area
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {EVERY_AREA.map((a) => (
            <li key={a.href}>
              <Link href={a.href} className="card press block p-4">
                <span className="font-semibold">{a.label}</span>
                <span className="t-small mt-0.5 block text-soft">{a.about}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
