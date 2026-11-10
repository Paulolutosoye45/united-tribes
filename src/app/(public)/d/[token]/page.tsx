import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { clockLabel, dayName } from "@/lib/academy/options";
import {
  DESK_SLOTS,
  DESK_WORDS as W,
  DESK_ZONES,
  becauseLine,
  groupWhen,
  isDeskAnswer,
  parseDeskInfo,
  seatsLine,
  type DeskAnswerKey,
  type DeskInfo,
} from "@/lib/desk/wording";
import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { deskAnswerAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "United Tribes",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = { a?: string; done?: string; closed?: string; off?: string; invalid?: string; problem?: string; times?: string };

export default async function DeskPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let info: DeskInfo | null = null;
  let fault = false;
  const secret = workerToken();
  if (/^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    try {
      const { data, error } = await workerRpc(secret)("worker_desk_info", { p_link: token });
      if (error) fault = true;
      else info = parseDeskInfo(data);
    } catch {
      fault = true;
    }
  }
  const done: DeskAnswerKey | null = isDeskAnswer(q.done) ? q.done : null;
  const pointed = isDeskAnswer(q.a) ? q.a : q.a === "time" ? "other_time" : q.a === "look" ? null : null;

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
          <h1 className="t-title rise-in">{info ? (info.kind === "tribe" ? W.tribeTitle(info.first) : W.interestTitle(info.first)) : W.site}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-16 pt-8 sm:px-8">
        {q.problem ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">
            {W.problem}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="card rise-in p-5 font-semibold" data-testid="desk-done">
            {W.done[done]}
          </p>
        ) : null}
        {q.closed ? <Note text={W.closed} /> : null}
        {q.off ? <Note text={W.off} /> : null}
        {!info ? (
          <Note text={fault ? W.fault : W.noPage} testid="desk-nopage" />
        ) : info.stopped ? (
          <Note text={W.done.stop} testid="desk-stopped" />
        ) : info.answered && info.answer && !done ? (
          <Note text={W.done[info.answer]} testid="desk-answered" />
        ) : !info.open ? (
          <>
            <Note text={info.kind === "tribe" ? W.gone : W.closed} testid="desk-closed" />
            <StopForm token={token} />
          </>
        ) : info.kind === "tribe" ? (
          <TribeCard info={info} token={token} pointed={pointed} />
        ) : (
          <InterestCard info={info} token={token} pointed={pointed} timesMissing={Boolean(q.times)} />
        )}
      </main>
    </div>
  );
}

const cap = (v: string) => `${v.slice(0, 1).toUpperCase()}${v.slice(1)}`;

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

function Answer({ token, answer, label, variant, note }: { token: string; answer: DeskAnswerKey; label: string; variant: "primary" | "quiet"; note?: string }) {
  return (
    <form action={deskAnswerAction} className="flex flex-col gap-2">
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

function TribeCard({ info, token, pointed }: { info: DeskInfo; token: string; pointed: DeskAnswerKey | null }) {
  const zone = info.mode === "online" ? "" : DESK_ZONES[info.zone ?? ""] ?? "";
  const meets = `${info.meetingDay === null ? "" : `${dayName(info.meetingDay)}s at ${clockLabel(info.meetingTime)}, `}${info.mode === "online" ? "online" : `in person${zone ? `, ${zone}` : ""}`}`;
  const because = becauseLine(info.reasons);
  const seats = seatsLine(info.seatsLeft);
  return (
    <>
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="desk-tribe" data-testid="desk-tribe">
        <h2 id="desk-tribe" className="t-heading">
          {info.tribe}
        </h2>
        <p className="t-body">Led by {info.leaderFirst || "its leader"}. It meets {meets}.</p>
        {info.degree !== null ? <p className="t-body">It is a {info.degree}% fit with what you told us.{because ? ` ${because}` : ""}</p> : because ? <p className="t-body">{because}</p> : null}
        {seats ? <p className="t-body">{seats}</p> : null}
        <p className="t-small text-soft">{W.notice.nothingDecided}</p>
        <Link href="/tribe" className="btn-primary inline-flex h-14 items-center justify-center rounded-[var(--radius-control)] px-6 font-semibold" data-testid="desk-look">
          {W.openTribes}
        </Link>
      </section>
      <div className={pointed === "no" ? "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}>
        <Answer token={token} answer="no" label={W.buttons.no} variant="quiet" note={W.notice.noIsFine} />
      </div>
      <StopForm token={token} />
    </>
  );
}

function InterestCard({ info, token, pointed, timesMissing }: { info: DeskInfo; token: string; pointed: DeskAnswerKey | null; timesMissing: boolean }) {
  const about = [info.community, info.goal].filter(Boolean).join(": ");
  return (
    <>
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="desk-group" data-testid="desk-group">
        <h2 id="desk-group" className="t-heading">
          A new group
        </h2>
        {about ? <p className="t-body">{about}</p> : null}
        <p className="t-body">
          It would meet {groupWhen(info.slot, info.mode, info.zone).toLowerCase()}
          {info.capacity ? `, with up to ${info.capacity} people` : ""}. We are still finding its leader.
        </p>
        <p className="t-small text-soft">{W.notice.nothingYet}</p>
        <p className="t-small text-soft">{W.notice.silence}</p>
      </section>
      <div className={pointed === "yes" ? "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}>
        <Answer token={token} answer="yes" label={W.buttons.yes} variant="primary" />
      </div>
      <div className={pointed === "no" ? "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}>
        <Answer token={token} answer="no" label={W.buttons.no} variant="quiet" note={W.notice.noIsFine} />
      </div>
      <details className={`card p-5 ${pointed === "other_time" ? "ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}`} open={pointed === "other_time" || timesMissing}>
        <summary className="t-heading min-h-11 cursor-pointer">{W.buttons.time}</summary>
        <form action={deskAnswerAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="answer" value="other_time" />
          <fieldset className="flex flex-col gap-2">
            <legend className="t-body mb-1">{W.chooseTimes}</legend>
            {Object.entries(DESK_SLOTS).map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="slot" value={key} className="size-5" />
                <span className="t-body">{cap(label)}</span>
              </label>
            ))}
          </fieldset>
          {timesMissing ? (
            <p role="alert" className="t-small font-medium text-danger">
              {W.chooseTimes}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" fullWidth>
            {W.saveTimes}
          </Button>
        </form>
      </details>
      <StopForm token={token} />
    </>
  );
}
