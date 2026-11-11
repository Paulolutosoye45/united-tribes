import { placedAnswerAction } from "@/app/(public)/placed/[token]/actions";
import { Button } from "@/components/ui/Button";
import { ANSWER_WORDS as W, REASONS, WINDOWS, windowLabel, type AnswersInfo, type Done, type Pointed } from "@/lib/placement/answers";

// The member's other answers on the private page behind "Your tribe": Not this season (with one optional reason, from five), Call me (a time of day, and a number if we
// hold none), Remind me tonight, Stop these reminders and Don't call me. Everything is a press on a button from a short list; the one thing typed is a phone number for
// Call me. Opening the page, or an email's button, saves nothing: it only opens the answer the email pointed at, with a ring round it. The database decides whether an
// answer may be given and the page says so in words.

const RING = "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page";
const FIELD = "h-14 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base text-ink hover:border-soft focus:border-ink focus:outline-none";

type Props = {
  token: string;
  info: AnswersInfo;
  pointed: Pointed | null;
  /** The number the member wrote for Call me did not look right */
  badNumber: boolean;
  /** Why "Remind me tonight" could not be set */
  remindIssue: "closed" | "too_late" | null;
};

export function MemberAnswers({ token, info, pointed, badNumber, remindIssue }: Props) {
  // Stop works whatever the switch says, so an old email's link still does what it says; the rest need the answers to be On for this member
  const showStop = info.on || pointed === "stop";
  if (!info.on && !showStop) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="more-answers" data-testid={info.on ? "placed-more" : "placed-stop-only"}>
      {info.on ? (
        <div className="flex flex-col gap-1">
          <h2 id="more-answers" className="t-heading">
            {W.moreTitle}
          </h2>
          <p className="t-body text-soft">{W.moreBody}</p>
          <p className="t-body" data-testid="placed-deadline">
            {info.closed ? W.closedLine(info.deadline) : W.heldUntil(info.deadline)}
          </p>
        </div>
      ) : (
        <h2 id="more-answers" className="sr-only">
          {W.stopButton}
        </h2>
      )}

      {info.on ? <NotThisSeason token={token} pointed={pointed === "notnow"} /> : null}
      {info.on ? <CallMe token={token} info={info} pointed={pointed === "call" || badNumber} badNumber={badNumber} /> : null}
      {info.on ? <Remind token={token} info={info} pointed={pointed === "remind"} issue={remindIssue} /> : null}
      {showStop ? <Simple token={token} kind="stop_reminders" label={W.stopButton} note={info.stopped ? W.doneStop.title : W.stopNote} pointed={pointed === "stop"} done={info.stopped} /> : null}
      {info.on ? <Simple token={token} kind="dont_call" label={W.noCallButton} note={W.noCallNote} pointed={false} done={false} /> : null}
      {info.on ? (
        <p className="t-small text-soft" data-testid="placed-may-call">
          {W.officeMayCall}
        </p>
      ) : null}
    </section>
  );
}

function NotThisSeason({ token, pointed }: { token: string; pointed: boolean }) {
  return (
    <details className={`card p-5 ${pointed ? RING : ""}`} open={pointed} data-testid="placed-notnow-box">
      <summary className="t-heading min-h-11 cursor-pointer">{W.notNowButton}</summary>
      <form action={placedAnswerAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="kind" value="not_this_season" />
        <p className="t-small text-soft">{W.notNowNote}</p>
        <fieldset className="flex flex-col gap-2" data-testid="answer-reasons">
          <legend className="t-body mb-1">{W.reasonTitle}</legend>
          {REASONS.map((r) => (
            <label key={r.key} className="flex min-h-11 items-center gap-3">
              <input type="radio" name="reason" value={r.key} className="size-5" />
              <span className="t-body">{r.label}</span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="quiet" size="lg" fullWidth data-testid="placed-notnow-confirm">
          {W.notNowConfirm}
        </Button>
      </form>
    </details>
  );
}

function CallMe({ token, info, pointed, badNumber }: { token: string; info: AnswersInfo; pointed: boolean; badNumber: boolean }) {
  return (
    <details className={`card p-5 ${pointed ? RING : ""}`} open={pointed} data-testid="placed-call-box">
      <summary className="t-heading min-h-11 cursor-pointer">{info.closed ? W.callOffice : W.callButton}</summary>
      {info.callPending ? (
        <p role="status" className="t-body mt-4 font-semibold">
          {W.doneCallAgain}
        </p>
      ) : (
        <form action={placedAnswerAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="kind" value="call_me" />
          <p className="t-small text-soft">{info.closed ? W.callOfficeNote : W.callNote}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="t-body mb-1">{W.windowTitle}</legend>
            {WINDOWS.map((w) => (
              <label key={w.key} className="flex min-h-11 items-center gap-3">
                <input type="radio" name="window" value={w.key} className="size-5" />
                <span className="t-body">
                  {w.label} <span className="t-small text-soft">{w.hours}</span>
                </span>
              </label>
            ))}
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" name="window" value="" className="size-5" defaultChecked />
              <span className="t-body">{W.windowAny}</span>
            </label>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <p className="t-small text-soft" data-testid="placed-call-number-line">
              {info.number ? W.haveNumber(info.number) : W.noNumber}
            </p>
            <label htmlFor="call-phone" className="text-[0.95rem] font-medium">
              {W.numberLabel}
            </label>
            <input id="call-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+234 803 123 4567" maxLength={40} required={!info.number} className={FIELD} />
            <p className="t-small text-soft">{W.numberHint}</p>
            {badNumber ? (
              <p role="alert" className="t-small font-medium text-danger" data-testid="placed-call-number-problem">
                {W.badNumber}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="quiet" size="lg" fullWidth data-testid="placed-call-confirm">
            {W.callConfirm}
          </Button>
        </form>
      )}
    </details>
  );
}

function Remind({ token, info, pointed, issue }: { token: string; info: AnswersInfo; pointed: boolean; issue: "closed" | "too_late" | null }) {
  if (info.remindSet) {
    return (
      <p role="status" className="t-body font-semibold" data-testid="placed-remind-set">
        {W.doneRemindAgain}
      </p>
    );
  }
  if (!info.remindPossible || issue) {
    // Nothing to press. Said only when the email's button pointed here or a press was refused, so the page is not cluttered with a button that cannot be used.
    const closed = info.closed || issue === "closed";
    return pointed || issue ? (
      <p role="status" className={`t-body ${pointed ? RING : ""}`} data-testid="placed-remind-closed">
        {closed ? W.closedRemind : W.remindClosed}
      </p>
    ) : null;
  }
  return (
    <form action={placedAnswerAction} className={`flex flex-col gap-2 ${pointed ? RING : ""}`} data-testid="placed-remind-form">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value="remind_tonight" />
      <Button type="submit" variant="quiet" size="lg" fullWidth data-testid="placed-remind">
        {info.remindTomorrow ? W.remindButtonTomorrow : W.remindButton}
      </Button>
      <p className="t-small text-soft">{info.remindTomorrow ? W.remindNoteTomorrow : W.remindNote}</p>
    </form>
  );
}

function Simple({ token, kind, label, note, pointed, done }: { token: string; kind: "stop_reminders" | "dont_call"; label: string; note: string; pointed: boolean; done: boolean }) {
  const slug = kind === "stop_reminders" ? "stop" : "dont-call";
  if (done) {
    return (
      <p role="status" className="t-body font-semibold" data-testid={`placed-${slug}-done`}>
        {note}
      </p>
    );
  }
  return (
    <form action={placedAnswerAction} className={`flex flex-col gap-2 ${pointed ? RING : ""}`} data-testid={`placed-${slug}-form`}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" variant="quiet" size="lg" fullWidth data-testid={`placed-${slug}`}>
        {label}
      </Button>
      <p className="t-small text-soft">{note}</p>
    </form>
  );
}

/** What the page says after an answer was saved. The seat is given up for "Not this season", so that one stands alone; the others sit above the tribe. */
export function AnswerDone({ kind, again, window }: { kind: Done; again: boolean; window: string | null }) {
  const said =
    kind === "notnow"
      ? W.doneNotNow
      : kind === "call"
        ? again
          ? { title: W.doneCallAgain, body: "" }
          : W.doneCall(windowLabel(window))
        : kind === "remind"
          ? again
            ? { title: W.doneRemindAgain, body: "" }
            : W.doneRemind
          : kind === "stop"
            ? W.doneStop
            : W.doneNoCall;
  return (
    <div role="status" className="card rise-in flex flex-col gap-2 p-6" data-testid={kind === "notnow" ? "placed-notnow" : "placed-answer-done"} data-kind={kind}>
      <h2 className="t-heading">{said.title}</h2>
      {said.body ? <p className="t-body text-soft">{said.body}</p> : null}
    </div>
  );
}
