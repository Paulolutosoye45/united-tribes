import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { OFFER_REASONS, OFFER_WORDS as W, groupWhen, isOfferAnswer, offerCountLine, parseOfferInfo, type OfferAnswerKey, type OfferInfo } from "@/lib/desk/wording";
import { getSupabaseEnv } from "@/lib/env";
import { GOAL_RELATIONS, LEAD_BEST } from "@/lib/leaders/options";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { offerAnswerAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "United Tribes",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = { a?: string; done?: string; closed?: string; taken?: string; off?: string; invalid?: string; problem?: string; need?: string; review?: string; late?: string };

export default async function OfferPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let info: OfferInfo | null = null;
  let fault = false;
  const secret = workerToken();
  if (/^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    try {
      const { data, error } = await workerRpc(secret)("worker_desk_offer_info", { p_link: token });
      if (error) fault = true;
      else info = parseOfferInfo(data);
    } catch {
      fault = true;
    }
  }
  const done: OfferAnswerKey | null = isOfferAnswer(q.done) ? q.done : null;
  const pointed: OfferAnswerKey | null = isOfferAnswer(q.a) ? q.a : null;
  const doneText = done ? (done === "lead" && q.review ? W.done.leadReview : done === "tomorrow" && q.late ? W.done.tomorrowLate : W.done[done]) : null;

  return (
    <div className="min-h-dvh bg-page">
      <header className="night safe-top px-5 pb-8 pt-6 [--safe-pt:0.5rem] sm:px-8">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <div className="flex items-center gap-3">
            <Crest size={28} tone="light" />
            <span className="t-heading" style={{ fontStretch: "88%" }}>
              {W.site}
            </span>
          </div>
          <h1 className="t-title rise-in">{info ? W.title(info.first) : W.site}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-16 pt-8 sm:px-8">
        {q.problem ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">
            {W.problem}
          </p>
        ) : null}
        {doneText ? (
          <p role="status" className="card rise-in p-5 font-semibold" data-testid="offer-done">
            {doneText}
          </p>
        ) : null}
        {q.closed ? <Note text={W.closed} /> : null}
        {q.taken ? <Note text={W.taken} testid="offer-assist-taken" /> : null}
        {q.off ? <Note text={W.off} /> : null}
        {!info ? (
          <Note text={fault ? W.fault : W.noPage} testid="offer-nopage" />
        ) : info.stopped ? (
          <Note text={W.done.stop} testid="offer-stopped" />
        ) : done && done !== "call" && done !== "tomorrow" ? null : info.status === "accepted" ? (
          <Note text={W.done.lead} testid="offer-accepted" />
        ) : info.status === "review" ? (
          <Note text={W.done.leadReview} testid="offer-review" />
        ) : info.answer === "never" ? (
          <Note text={W.done.never} testid="offer-never" />
        ) : info.answer === "assist" ? (
          <Note text={W.done.assist} testid="offer-assisting" />
        ) : info.answer === "not_season" ? (
          <Note text={W.done.not_season} testid="offer-declined" />
        ) : !info.open ? (
          <>
            <Note text={W.closed} testid="offer-closed" />
            <StopForm token={token} />
          </>
        ) : (
          <Open info={info} token={token} pointed={pointed} need={q.need ?? null} />
        )}
      </main>
    </div>
  );
}

function Note({ text, testid }: { text: string; testid?: string }) {
  return (
    <div className="card rise-in flex flex-col gap-3 p-6" role="status" data-testid={testid}>
      <p className="t-body">{text}</p>
      <Link href="/tribe" className="min-h-11 font-semibold underline underline-offset-4">
        {W.openTribes}
      </Link>
    </div>
  );
}

function Answer({ token, answer, label, variant, note }: { token: string; answer: OfferAnswerKey; label: string; variant: "primary" | "quiet"; note?: string }) {
  return (
    <form action={offerAnswerAction} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="answer" value={answer} />
      <Button type="submit" variant={variant} size="lg" fullWidth>
        {label}
      </Button>
      {note ? <p className="t-small text-soft">{note}</p> : null}
    </form>
  );
}

function StopForm({ token }: { token: string }) {
  return <Answer token={token} answer="stop" label={W.buttons.stop} variant="quiet" note={W.notice.stopWhy} />;
}

const ring = "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page";

function Open({ info, token, pointed, need }: { info: OfferInfo; token: string; pointed: OfferAnswerKey | null; need: string | null }) {
  const about = [info.community, info.goal].filter(Boolean).join(": ");
  const counts = offerCountLine(info.members, info.asked, info.yes);
  // A missing answer on one form must not open or mark the other
  const leadNeed = pointed === "lead" ? need : null;
  return (
    <>
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="offer-group" data-testid="offer-group">
        <h2 id="offer-group" className="t-heading">
          A new group
        </h2>
        {about ? <p className="t-body">{about}</p> : null}
        <p className="t-body">
          It would meet {groupWhen(info.slot, info.mode, info.zone).toLowerCase()}
          {info.capacity ? `, with up to ${info.capacity} people` : ""}.{counts ? ` ${counts}` : ""}
        </p>
        <p className="t-body">{W.notice.ask}</p>
        <p className="t-small text-soft">{W.notice.support}</p>
        {info.ends ? <p className="t-small font-semibold">Please answer by {info.ends}.</p> : null}
        <p className="t-small text-soft">{W.notice.silence}</p>
      </section>

      <details className={`card p-5 ${pointed === "lead" ? ring : ""}`} open={pointed === "lead"} data-testid="offer-lead">
        <summary className="t-heading min-h-11 cursor-pointer">{W.buttons.lead}</summary>
        <form action={offerAnswerAction} className="mt-4 flex flex-col gap-5">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="answer" value="lead" />
          <p className="t-small text-soft">{W.notice.nothingYet}</p>
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" name="age" className="mt-1 size-5" required />
            <span className="t-body">{W.yes.age}</span>
          </label>
          {leadNeed === "age" ? <Need text={W.yes.needAge} /> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="t-body mb-1 font-semibold">{W.yes.leadBest}</legend>
            {LEAD_BEST.map((o) => (
              <label key={o.id} className="flex min-h-11 items-start gap-3">
                <input type="radio" name="lead" value={o.id} className="mt-1 size-5" required />
                <span className="t-body">
                  {o.label}
                  <span className="t-small block text-soft">{o.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {leadNeed === "lead" ? <Need text={W.yes.needLead} /> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="t-body mb-1 font-semibold">{W.yes.relation}</legend>
            {GOAL_RELATIONS.map((o) => (
              <label key={o.id} className="flex min-h-11 items-start gap-3">
                <input type="radio" name="relation" value={o.id} className="mt-1 size-5" required />
                <span className="t-body">
                  {o.label}
                  <span className="t-small block text-soft">{o.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {leadNeed === "relation" ? <Need text={W.yes.needRelation} /> : null}
          <Button type="submit" variant="primary" size="lg" fullWidth>
            {W.buttons.sendYes}
          </Button>
        </form>
      </details>

      {info.assistOpen ? (
        <details className={`card p-5 ${pointed === "assist" ? ring : ""}`} open={pointed === "assist"} data-testid="offer-assist">
          <summary className="t-heading min-h-11 cursor-pointer">{W.buttons.assist}</summary>
          <form action={offerAnswerAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="answer" value="assist" />
            <p className="t-small text-soft">{W.notice.assistWhy}</p>
            <p className="t-small text-soft">{W.notice.assistNothingYet}</p>
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" name="age" className="mt-1 size-5" required />
              <span className="t-body">{W.yes.assistAge}</span>
            </label>
            {pointed === "assist" && need === "age" ? <Need text={W.yes.needAssistAge} /> : null}
            <Button type="submit" variant="primary" size="lg" fullWidth>
              {W.buttons.sendAssist}
            </Button>
          </form>
        </details>
      ) : null}

      <details className={`card p-5 ${pointed === "not_season" ? ring : ""}`} open={pointed === "not_season"} data-testid="offer-not-season">
        <summary className="t-heading min-h-11 cursor-pointer">{W.buttons.notSeason}</summary>
        <form action={offerAnswerAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="answer" value="not_season" />
          <p className="t-small text-soft">{W.notice.noIsFine}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="t-body mb-1">{W.reasonsHeading}</legend>
            {OFFER_REASONS.map((r) => (
              <label key={r.id} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="reason" value={r.id} className="size-5" />
                <span className="t-body">{r.label}</span>
              </label>
            ))}
          </fieldset>
          <p className="t-small text-soft">{W.notice.reasonsWhy}</p>
          <Button type="submit" variant="quiet" size="lg" fullWidth>
            {W.buttons.notSeason}
          </Button>
        </form>
      </details>

      <div className={pointed === "call" ? ring : ""}>
        <Answer token={token} answer="call" label={W.buttons.call} variant="quiet" note={W.notice.callWhy} />
      </div>
      <div className={pointed === "tomorrow" ? ring : ""}>
        <Answer token={token} answer="tomorrow" label={W.buttons.tomorrow} variant="quiet" />
      </div>
      <div className={pointed === "never" ? ring : ""}>
        <Answer token={token} answer="never" label={W.buttons.never} variant="quiet" note={W.notice.neverWhy} />
      </div>
      <div className={pointed === "stop" ? ring : ""}>
        <StopForm token={token} />
      </div>
    </>
  );
}

function Need({ text }: { text: string }) {
  return (
    <p role="alert" className="t-small font-medium text-danger">
      {text}
    </p>
  );
}
