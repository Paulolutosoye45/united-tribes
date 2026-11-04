"use client";

import { useState } from "react";
import { askTribeAction, followUpAction, tribeNoteAction } from "@/app/(app)/lead/reach-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { formatLagosDay } from "@/lib/dates";
import { STRIP_WORDS as W, type StripPerson, type TribeStrip } from "@/lib/reach/series";

const TEXTAREA =
  "w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 py-3 text-base text-ink hover:border-soft " +
  "focus:border-ink focus:outline-none focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)]";

function statusWords(p: StripPerson): string {
  switch (p.status) {
    case "to_ask":
      return W.statusLine.to_ask;
    case "first_go":
      return W.statusLine.first_go;
    case "asked":
      return W.statusLine.asked(p.email);
    case "follow_up":
      return W.statusLine.follow_up;
    case "email_only":
      return W.statusLine.email_only;
    default:
      return W.statusLine.asked_out;
  }
}

/**
 * How many of the tribe a leader can message on WhatsApp, and the three things a leader can do about the rest: ask them all in one press (the church
 * sends the first email in the leader’s name, then three more), say they will follow one person up themselves, and write to the tribe. Names only.
 * No number is ever on this screen. The database decides who may do what; this only shows it.
 */
export function ReachStrip({ tribeId, strip }: { tribeId: string; strip: TribeStrip }) {
  const d = useDo();
  const [asking, setAsking] = useState(false);
  const [line, setLine] = useState("");
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  const pct = strip.adults > 0 ? Math.round((strip.reachable / strip.adults) * 100) : 0;
  const nextAsk = strip.ask.nextAt ? formatLagosDay(strip.ask.nextAt) : null;
  const nextNote = strip.note.nextAt ? formatLagosDay(strip.note.nextAt) : null;

  async function ask() {
    let sent = 0;
    const ok = await d.go(
      "ask",
      async () => {
        const r = await askTribeAction(tribeId, line);
        if (r.ok) sent = r.sent;
        return r;
      },
      { after: () => undefined },
    );
    if (ok) {
      setAsking(false);
      setLine("");
      setSaid(W.sent(sent));
    }
  }

  async function note() {
    let sent = 0;
    let rehearsal = false;
    const ok = await d.go("note", async () => {
      const r = await tribeNoteAction(tribeId, body);
      if (r.ok) {
        sent = r.sent;
        rehearsal = r.rehearsal === true;
      }
      return r;
    });
    if (ok) {
      setWriting(false);
      setBody("");
      setSaid(rehearsal ? W.noteRehearsal : W.noteSent(sent));
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-control)] bg-gold/20 px-4 py-4" data-testid="reach-strip">
      {strip.on ? (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">{W.title}</h3>
            <p className="t-body" data-testid="reach-line">
              {strip.adults > 0 && strip.reachable === strip.adults ? W.allReachable : W.line(strip.reachable, strip.adults)}
            </p>
            {strip.adults > 0 ? (
              <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-line/70">
                <div className="h-full rounded-full bg-flame" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>

          {strip.ask.count > 0 ? (
            asking ? (
              <div className="card flex flex-col gap-3 p-4" data-testid="ask-panel">
                <p className="t-body">{W.askBody(strip.ask.count)}</p>
                {strip.ask.names.length > 0 ? <p className="t-small font-medium">{strip.ask.names.join(", ")}</p> : null}
                <p className="t-small text-soft">{W.askAuto}</p>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ask-line" className="text-[0.95rem] font-medium">
                    {W.lineLabel}
                  </label>
                  <textarea id="ask-line" rows={3} maxLength={W.lineMax} value={line} onChange={(e) => setLine(e.target.value)} className={TEXTAREA} aria-describedby="ask-line-hint" />
                  <p id="ask-line-hint" className="t-small text-soft">
                    {W.lineHint} {line.length}/{W.lineMax}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button size="md" loading={d.busy === "ask"} onClick={() => void ask()} data-testid="ask-confirm">
                    {W.confirm(strip.ask.count)}
                  </Button>
                  <Button size="md" variant="ghost" onClick={() => setAsking(false)}>
                    {W.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div>
                  <Button size="md" disabled={!strip.ask.can} onClick={() => { setSaid(null); d.clear(); setAsking(true); }} data-testid="ask-open">
                    {W.askButton}
                  </Button>
                </div>
                {!strip.ask.can && nextAsk ? <p className="t-small text-soft">{W.nextAsk(nextAsk)}</p> : null}
              </div>
            )
          ) : null}

          {strip.people.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line/60">
              {strip.people.map((p) => (
                <li key={p.personId} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="reach-person" data-status={p.status}>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{p.firstName}</span>
                    <span className="t-small text-soft">{statusWords(p)}</span>
                  </span>
                  {p.status === "first_go" || p.status === "asked" ? (
                    p.followUpUsed ? (
                      <span className="t-small text-soft">{W.followUpUsed}</span>
                    ) : (
                      <Button
                        variant="quiet"
                        size="sm"
                        loading={d.busy === p.personId}
                        onClick={() => void d.go(p.personId, () => followUpAction(p.personId), { saved: W.followUpDone(p.firstName) })}
                      >
                        {W.followUp}
                      </Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {strip.note.state !== "off" ? (
        <div className="flex flex-col gap-2" data-testid="tribe-note">
          {writing ? (
            <div className="card flex flex-col gap-3 p-4">
              <h3 className="font-semibold">{W.noteTitle}</h3>
              <p className="t-small text-soft">{W.noteBody}</p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="note-body" className="text-[0.95rem] font-medium">
                  {W.noteLabel}
                </label>
                <textarea id="note-body" rows={6} maxLength={W.noteMax} value={body} onChange={(e) => setBody(e.target.value)} className={TEXTAREA} aria-describedby="note-hint" />
                <p id="note-hint" className="t-small text-soft">
                  {W.noteHint} {body.length}/{W.noteMax}
                </p>
              </div>
              {strip.note.state === "rehearsal" ? <p className="t-small text-soft">{W.noteRehearsal}</p> : null}
              <div className="flex flex-wrap gap-3">
                <Button size="md" loading={d.busy === "note"} disabled={body.trim() === ""} onClick={() => void note()} data-testid="note-send">
                  {W.noteSend}
                </Button>
                <Button size="md" variant="ghost" onClick={() => setWriting(false)}>
                  {W.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <Button size="md" variant="quiet" disabled={!strip.note.can} onClick={() => { setSaid(null); d.clear(); setWriting(true); }} data-testid="note-open">
                  {W.noteTitle}
                </Button>
              </div>
              <p className="t-small text-soft">{strip.note.can ? W.noteCount(strip.note.used, strip.note.limit) : W.noteLimit(strip.note.limit, nextNote)}</p>
            </>
          )}
        </div>
      ) : null}

      {said ? <p role="status" className="t-small rounded-[var(--radius-control)] bg-raised px-4 py-3 font-medium" data-testid="reach-said">{said}</p> : null}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
