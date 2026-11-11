import Link from "next/link";
import { DeskSettings } from "@/components/god/DeskSettings";
import { DeskWhatsApp } from "@/components/god/DeskWhatsApp";
import { DeskWithdraw } from "@/components/god/DeskWithdraw";
import { Badge } from "@/components/ui/Badge";
import { PAGE_SIZE, slotWord } from "@/lib/god/desk";
import { SEND_WORDS as S, canWithdraw, statusWord, type ProposalRow, type ProposalsPage, type SendState, type WhatsAppState } from "@/lib/god/desk-send";

const href = (page: number) => `/god/leader-desk?${new URLSearchParams({ tab: "sending", ...(page > 1 ? { page: String(page) } : {}) }).toString()}`;

const when = (iso: string | null): string => {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(t);
};

function Row({ r }: { r: ProposalRow }) {
  return (
    <li className="card flex flex-wrap items-start justify-between gap-3 p-4" data-testid="desk-sent-row" data-status={r.status}>
      <div className="flex flex-col gap-0.5">
        <p className="font-semibold">{r.name}</p>
        <p className="t-small text-soft">
          {S.kind[r.kind]}
          {r.target ? `: ${r.target}` : ""}
          {r.degree !== null ? ` · ${r.degree}% fit` : ""}
          {r.at ? ` · ${when(r.at)}` : ""}
        </p>
        <p className="t-body">{statusWord(r)}</p>
        {r.answer === "other_time" && r.slots.length > 0 ? <p className="t-small text-soft">{r.slots.map(slotWord).join(", ")}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {r.rehearsal ? <Badge tone="gold">Rehearsal</Badge> : null}
        {canWithdraw(r) ? <DeskWithdraw id={r.id} /> : null}
      </div>
    </li>
  );
}

/** The Sending tab: whether the Desk's email is on, the limits it works within, and every email it sent or, in Rehearsal, only wrote down. */
export function DeskSending({ state, page, pageNo, whatsapp = null }: { state: SendState | null; page: ProposalsPage; pageNo: number; whatsapp?: WhatsAppState | null }) {
  if (!state) {
    return (
      <p className="card t-body p-5 text-soft" data-testid="desk-sending-missing">
        The Desk’s email is not available yet. The database update for it has not been applied.
      </p>
    );
  }
  const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  const c = page.counts;
  return (
    <section aria-labelledby="desk-sending-h" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="desk-sending-h" className="t-heading">
          {S.title}
        </h2>
        <p className="t-small measure text-soft">{S.intro}</p>
      </div>

      <div className="card flex flex-col gap-2 p-4" data-testid="desk-send-status" data-mode={state.mode}>
        <p className="t-body font-medium">{S.modes[state.mode]}</p>
        {state.paused ? <p className="t-small text-danger">{S.paused}</p> : null}
        <p className="t-small text-soft">
          {S.today(state.sentToday, state.wouldToday)} {state.sendingHours ? "It is inside sending hours now." : "It is outside sending hours, so an email waits until 9 am."}
        </p>
      </div>

      <DeskSettings state={state} />

      {whatsapp ? <DeskWhatsApp state={whatsapp} /> : null}

      <div className="flex flex-col gap-3">
        <h3 className="t-heading">{S.listTitle}</h3>
        <div className="flex flex-wrap items-center gap-2" data-testid="desk-send-counts">
          <Badge tone="neutral">{c.sent} waiting for an answer</Badge>
          <Badge tone="neutral">{c.wouldSend} written down in Rehearsal</Badge>
          <Badge tone="neutral">{c.yes} yes</Badge>
          <Badge tone="neutral">{c.otherTime} different time</Badge>
          <Badge tone="neutral">{c.no} not for me</Badge>
          <Badge tone="neutral">{c.stop} asked us to stop</Badge>
          <Badge tone="neutral">{c.expired} no answer in time</Badge>
        </div>
        {page.rows.length === 0 ? (
          <p className="card t-body p-5 text-soft">{S.listEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {page.rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3">
            {pageNo > 1 ? (
              <Link href={href(pageNo - 1)} className="t-body underline">
                Earlier
              </Link>
            ) : (
              <span />
            )}
            <span className="t-small text-soft">
              Page {pageNo} of {pages}
            </span>
            {pageNo < pages ? (
              <Link href={href(pageNo + 1)} className="t-body underline">
                Later
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </section>
  );
}
