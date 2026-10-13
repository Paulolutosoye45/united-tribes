import Link from "next/link";
import { WeekBars } from "@/components/dashboard/WeekBars";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { plural } from "@/lib/dates";
import type { CommunityTribe, CommunityPage } from "@/lib/dashboard/insight";
import { VERDICTS, pct, signed } from "@/lib/dashboard/wording";

/** A community champion's page: the community's tribes, seats against demand, and what has been shared. */
export function CommunityView({ page }: { page: CommunityPage }) {
  if (page.state === "none" || !page.season || !page.headline) {
    return <p className="t-body measure text-soft">No season has been set up yet, so there is nothing to show.</p>;
  }
  const s = page.season;
  const h = page.headline;
  const minCell = page.min_cell ?? 5;
  const where = page.state === "before" ? "the season has not started" : page.state === "complete" ? "the season has ended" : `week ${s.current_week} of ${s.weeks}`;
  const hidden = h.members > 0 && h.thriving_rate === undefined;
  const bars = (page.weeks ?? []).map((w) => ({
    week: w.week,
    current: w.current,
    attendance: w.possible > 0 ? w.present / w.possible : null,
    steps: w.steps_checked > 0 ? w.steps_done / w.steps_checked : null,
  }));
  const short = (page.supply ?? []).reduce((a, c) => a + c.short, 0);
  const toOpen = (page.supply ?? []).reduce((a, c) => a + c.tribes_to_open, 0);
  const wants = (page.supply ?? []).reduce((a, c) => a + c.wants, 0);
  const seats = (page.supply ?? []).reduce((a, c) => a + c.seats, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-body text-soft">
          {s.name}: {where}.
        </p>
        {page.communities.length > 1 ? (
          <nav aria-label="Communities" className="flex flex-wrap gap-2">
            {page.communities.map((t) => (
              <Link
                key={t.id}
                href={`/community?community=${t.id}&season=${s.id}`}
                aria-current={t.id === page.community.id ? "page" : undefined}
                className={`press inline-flex min-h-10 items-center rounded-full border-[1.5px] px-4 text-[0.9rem] font-medium ${t.id === page.community.id ? "border-ink bg-ink text-page" : "border-line bg-raised text-soft hover:border-soft hover:text-ink"}`}
              >
                {t.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <section aria-labelledby="community-numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="community-numbers" className="sr-only">
          The community in numbers
        </h2>
        <Tile label="Members" value={String(h.members)} note={`${plural(h.tribes, "tribe")}`} />
        <Tile
          label="Thriving"
          value={hidden ? "–" : h.thriving_rate != null ? pct(h.thriving_rate) : "–"}
          note={
            hidden
              ? `Shown when the community has ${minCell} members (now ${h.members}).`
              : h.thriving_rate != null
                ? `${h.thriving} of ${h.members}. The goal is ${pct(page.targets?.thriving_rate ?? 0.85)}.`
                : `Shown after ${plural(page.targets?.min_weeks ?? 3, "week")} of the season.`
          }
        />
        <Tile label="Came to meetings" value={pct(h.attendance_rate ?? null)} note={h.attendance_rate == null ? "No meetings logged yet." : "Of the places at meetings held so far."} />
        <Tile
          label="Success Picture"
          value={h.gain_avg != null ? signed(h.gain_avg) : "–"}
          note={h.gain_avg != null ? `${pct(h.gain_share ?? null)} gained ${page.targets?.gain_min ?? 2} points or more.` : "Shown once enough members have answered."}
        />
      </section>

      {page.state !== "before" && bars.length > 0 ? <WeekBars weeks={s.weeks} rows={bars} pace={2 / 3} title="Week by week in this community" /> : null}

      <section aria-labelledby="community-tribes" className="flex flex-col gap-4">
        <h2 id="community-tribes" className="t-heading">
          Tribes in {page.community.name}
        </h2>
        {(page.tribes ?? []).length === 0 ? (
          <p className="t-body text-soft">There is no approved tribe in this community yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(page.tribes ?? []).map((c) => (
              <TribeRow key={c.tribe_id} c={c} minCell={minCell} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="community-seats" className="card flex flex-col gap-4 p-5 sm:p-7">
        <div className="flex flex-col gap-1">
          <h2 id="community-seats" className="t-heading">
            Seats and demand
          </h2>
          <p className="t-small text-soft">
            {wants} {wants === 1 ? "member has" : "members have"} chosen {page.community.name}; there {seats === 1 ? "is" : "are"} {seats} {seats === 1 ? "seat" : "seats"} in approved tribes with a certified leader.{" "}
            {short > 0 ? `${short} more seats are needed: about ${plural(toOpen, "more tribe")}.` : "There are enough seats."}
          </p>
        </div>
        {(page.supply ?? []).length > 0 ? (
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[26rem] text-left">
              <caption className="sr-only">Members who chose this community against seats, by life stage</caption>
              <thead>
                <tr className="t-small text-soft">
                  <th scope="col" className="pb-2 font-medium">Life stage</th>
                  <th scope="col" className="pb-2 text-right font-medium">Want a tribe</th>
                  <th scope="col" className="pb-2 text-right font-medium">Seats</th>
                  <th scope="col" className="pb-2 text-right font-medium">Short by</th>
                  <th scope="col" className="pb-2 text-right font-medium">Tribes to open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(page.supply ?? []).map((c) => (
                  <tr key={c.track}>
                    <th scope="row" className="py-2 pr-3 font-medium">{c.track}</th>
                    <td className="py-2 text-right [font-variant-numeric:tabular-nums]">{c.wants}</td>
                    <td className="py-2 text-right [font-variant-numeric:tabular-nums]">{c.seats}</td>
                    <td className={`py-2 text-right font-semibold [font-variant-numeric:tabular-nums] ${c.short > 0 ? "text-flame-deep" : ""}`}>{c.short > 0 ? c.short : "–"}</td>
                    <td className="py-2 text-right [font-variant-numeric:tabular-nums]">{c.tribes_to_open > 0 ? c.tribes_to_open : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="t-body text-soft">Nobody has chosen this community yet.</p>
        )}
        <p className="t-small text-soft">“Tribes to open” assumes about ten members to a tribe. Ask your coaches and pastors for leaders in the life stages marked short.</p>
      </section>

      {page.testimonies ? (
        <section aria-labelledby="community-testimonies" className="card flex flex-col gap-4 p-5 sm:p-7">
          <div className="flex flex-col gap-1">
            <h2 id="community-testimonies" className="t-heading">
              What God is doing
            </h2>
            <p className="t-small text-soft">
              {plural(page.testimonies.church, "testimony", "testimonies")} shared with the whole church from this community
              {page.testimonies.waiting > 0 ? `; ${page.testimonies.waiting} waiting for a leader or pastor to read.` : "."}
            </p>
          </div>
          {page.testimonies.recent.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {page.testimonies.recent.map((t, i) => (
                <li key={i} className="rounded-[var(--radius-control)] border-l-4 border-gold bg-surface-strong px-4 py-3">
                  <p className="t-body">“{t.body}”</p>
                  <p className="t-small mt-1 text-soft">{t.who}{t.goal ? ` · ${t.goal}` : ""}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="community-care" className="card flex flex-col gap-2 p-5 sm:p-7">
        <h2 id="community-care" className="t-heading">
          Care in this community
        </h2>
        <p className="t-body text-soft">
          {page.care?.open ? `${plural(page.care.open, "care task")} open${page.care.late ? `, ${page.care.late} late` : ""}.` : "No care task is open."} Names stay with the care team; you see only the counts.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-small text-soft">{page.champions && page.champions.length > 0 ? `Community champions: ${page.champions.join(", ")}.` : ""}</p>
        <Link href="/reports" className={buttonClasses({ variant: "quiet", size: "md" })}>
          <span className="relative">Monthly reports</span>
        </Link>
      </div>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card flex flex-col gap-1 p-5">
      <p className="t-small text-soft">{label}</p>
      <p className="t-figure !text-[clamp(1.8rem,7vw,2.4rem)]">{value}</p>
      <p className="t-small text-soft">{note}</p>
    </div>
  );
}

function TribeRow({ c, minCell }: { c: CommunityTribe; minCell: number }) {
  const small = c.verdict === "small";
  const v = c.verdict === "small" ? null : VERDICTS[c.verdict];
  return (
    <li className="card flex flex-col gap-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{c.name}</p>
          <p className="t-small text-soft">
            Led by {c.leader} · {c.members} of {c.capacity} places{c.track ? ` · ${c.track}` : ""}
          </p>
        </div>
        {v ? <Badge tone={v.tone}>{v.text}</Badge> : <Badge tone="outline">Too few to rate</Badge>}
      </div>
      <p className="t-small text-soft">
        {c.held > 0 ? `${plural(c.held, "meeting")} held · ${pct(c.attendance_rate)} came` : "No meeting logged yet"}
        {small ? ` · a rate is shown from ${minCell} members` : c.thriving_rate != null ? ` · ${pct(c.thriving_rate)} thriving` : ""}
      </p>
    </li>
  );
}
