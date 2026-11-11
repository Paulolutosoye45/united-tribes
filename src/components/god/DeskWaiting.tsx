import Link from "next/link";
import { DeskAddToDraft } from "@/components/god/DeskAddToDraft";
import { DeskPropose } from "@/components/god/DeskPropose";
import { DeskRecommend } from "@/components/god/DeskRecommend";
import { DeskReveal } from "@/components/god/DeskReveal";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { CHIPS, DESK_WORDS as W, PAGE_SIZE, SLOTS, chipLabel, kindWord, modeWord, poolLabel, zoneWord, type Chip, type Overview, type WaitingPage, type WaitingRow } from "@/lib/god/desk";

const href = (chip: Chip | null, page = 1) => {
  const q = new URLSearchParams({ tab: "waiting" });
  if (chip) q.set("chip", chip);
  if (page > 1) q.set("page", String(page));
  return `/god/leader-desk?${q.toString()}`;
};

function Row({ r, rehearsal }: { r: WaitingRow; rehearsal: boolean }) {
  const times = r.times.length === 0 ? "Any time" : r.times.map((t) => SLOTS[t] ?? t).join(", ");
  return (
    <li className="card flex flex-col gap-3 p-4" data-testid="desk-waiting-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{r.name}</p>
          <p className="t-small text-soft">
            {W.waitingDays(r.days)}
            {r.community ? ` · ${r.community}` : ""}
            {r.goal ? ` · ${r.goal}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{chipLabel(r.chip)}</Badge>
          {r.starter ? <Badge tone="gold">Starter tribe</Badge> : null}
          {r.lead ? (
            <Badge tone={r.lead.pool === "ready" ? "flame" : "neutral"}>
              Lead signal {r.lead.score}
              {r.lead.pool !== "members" ? ` · ${poolLabel(r.lead.pool)}` : ""}
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="t-small text-soft">
        {r.mode ? modeWord(r.mode) : ""}
        {r.zone ? ` · ${zoneWord(r.zone)}` : ""} · {times}
        {r.kind ? ` · ${kindWord(r.kind)} group` : ""}
      </p>

      {r.block ? (
        <p className="t-body" data-testid="desk-block">
          <span className="font-semibold">Why no tribe fits: </span>
          {r.block.text}.
        </p>
      ) : (
        <p className="t-body">
          {W.hasOptions(r.options)}. <span className="text-soft">{W.bestFit(r.bestTribe, r.best)}</span>
        </p>
      )}

      {r.inDraft ? (
        <p className="t-small text-soft">{W.inDraft(r.inDraft)}</p>
      ) : r.drafts.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="How well they would suit each draft">
          {r.drafts.map((x) => (
            <li key={x.groupId}>
              <Badge tone={x.fits ? "neutral" : "outline"}>{x.fits ? W.fitsDraft(x.name, x.degree) : W.cannotFitDraft(x.name)}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DeskReveal person={r.personId} masked={r.phone} hasNumber={r.hasNumber} />
        {r.inDraft ? null : <DeskAddToDraft person={r.personId} drafts={r.drafts} />}
      </div>
      {r.block ? null : <DeskPropose person={r.personId} />}
      <DeskRecommend person={r.personId} rehearsal={rehearsal} />
    </li>
  );
}

/** The Waiting tab: the lists, then the members. Everything is read from the database; a person's full number is only ever opened on request. */
export function DeskWaiting({ overview, page, chip, pageNo }: { overview: Overview; page: WaitingPage; chip: Chip | null; pageNo: number }) {
  const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  return (
    <section aria-labelledby="desk-waiting-h" className="flex flex-col gap-4">
      <h2 id="desk-waiting-h" className="sr-only">
        Members still waiting for a tribe
      </h2>
      <nav aria-label="Lists of waiting members" className="flex flex-wrap gap-2">
        <Link
          href={href(null)}
          aria-current={chip === null ? "page" : undefined}
          className={cn("press rounded-full px-4 py-2 text-[0.92rem] font-medium", chip === null ? "bg-ink text-page" : "border border-line text-soft hover:text-ink")}
        >
          Everyone waiting
          <span className="ml-2 tabular-nums">{overview.waiting.all}</span>
        </Link>
        {CHIPS.map((c) => (
          <Link
            key={c.key}
            href={href(c.key)}
            title={c.help}
            aria-current={chip === c.key ? "page" : undefined}
            className={cn("press rounded-full px-4 py-2 text-[0.92rem] font-medium", chip === c.key ? "bg-ink text-page" : "border border-line text-soft hover:text-ink")}
          >
            {c.label}
            <span className="ml-2 tabular-nums">{overview.waiting[c.key]}</span>
          </Link>
        ))}
      </nav>
      {overview.heldBack > 0 ? <p className="t-small text-soft">{overview.heldBack} {overview.heldBack === 1 ? "member is" : "members are"} held back from placement and not listed here.</p> : null}
      <p className="t-small text-soft">{W.numberRules}</p>

      {page.rows.length === 0 ? (
        <p className="card t-body p-5 text-soft">{W.waitingEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.rows.map((r) => (
            <Row key={r.personId} r={r} rehearsal={overview.mode !== "on"} />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {pageNo > 1 ? (
            <Link href={href(chip, pageNo - 1)} className="t-body underline">
              Earlier
            </Link>
          ) : (
            <span />
          )}
          <span className="t-small text-soft">
            Page {pageNo} of {pages}
          </span>
          {pageNo < pages ? (
            <Link href={href(chip, pageNo + 1)} className="t-body underline">
              Later
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
