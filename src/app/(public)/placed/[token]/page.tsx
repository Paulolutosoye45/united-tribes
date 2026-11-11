import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { AnswerDone, MemberAnswers } from "@/components/placed/MemberAnswers";
import { Button } from "@/components/ui/Button";
import { clockLabel, dayName } from "@/lib/academy/options";
import { getSupabaseEnv } from "@/lib/env";
import { formatShortDate } from "@/lib/dates";
import { AGREEMENT_SENTENCE, COVENANT_PROMISES } from "@/lib/matching/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { contactLine, groupNote } from "@/lib/placement/placed";
import { parsePlaced, type PlacedState } from "@/lib/placement/types";
import { PLACED_REACH_WORDS, ADD_NUMBER_WORDS, parsePlacedReach, type PlacedReach } from "@/lib/reach/series";
import { PLACED_CONTACT_WORDS, PLACED_PROMISES } from "@/lib/placement/wording";
import { FRESH_LINK_WORDS, LINK_WORDS, NUDGE_PAGE_OFF, NUDGE_PAGE_WORDS, parseLinkState, parseNudgePageInfo, type LinkState, type NudgePageInfo } from "@/lib/placement/nudge";
import { ANSWERS_OFF, isAnswerLink, isDone, isPointed, parseAnswersInfo, type AnswersInfo, type Done, type Pointed } from "@/lib/placement/answers";
import { placedAction, placedChooseAction, placedFreshLinkAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "Your tribe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = { a?: string; done?: string; late?: string; started?: string; invalid?: string; problem?: string; number?: string; m?: string; c?: string; other?: string; fresh?: string; again?: string; w?: string; cn?: string; rc?: string };

const CHOICES = ["confirm", "change", "withhold"] as const;
type Choice = (typeof CHOICES)[number];

export default async function PlacedPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let state: PlacedState | null = null;
  // Why there is no page: the link ran out, the place is gone, we never made it, or the server failed. "fault" is only the server.
  let why: LinkState | "fault" = "unknown";
  const secret = workerToken();
  if (/^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    const { data, error } = await workerRpc(secret)("worker_placed_info", { p_link: token });
    state = parsePlaced(data);
    if (!state) {
      if (error) why = "fault";
      else {
        // An older database has no such function and answers an error: the page then says what it always said
        const link = await workerRpc(secret)("worker_placed_link_state", { p_link: token }).catch(() => ({ data: null, error: { message: "", code: "" } }));
        why = link.error ? "unknown" : parseLinkState(link.data);
      }
    }
  }
  // The two-button answer of the placed nudge: only while the function is On for this member. Anything wrong means today's page.
  let nudge: NudgePageInfo = NUDGE_PAGE_OFF;
  if (state?.active && !state.confirmed && /^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    try {
      const { data } = await workerRpc(secret)("worker_placed_nudge_info", { p_link: token });
      nudge = parseNudgePageInfo(data);
    } catch {
      nudge = NUDGE_PAGE_OFF;
    }
  }
  // The two extra boxes on "Yes, I’m in": only while the contact series is On and the member has a number or a yes to put right. Anything wrong means no boxes.
  let reach: PlacedReach | null = null;
  if (state?.active && !state.confirmed && !nudge.on && /^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    try {
      const { data } = await workerRpc(secret)("worker_placed_reach", { p_link: token });
      reach = parsePlacedReach(data);
    } catch {
      reach = null;
    }
  }
  // The other answers (Not this season with its reasons, Call me, Remind me tonight, Stop, Don't call me): only while the seat is waiting. Anything wrong means none.
  let answers: AnswersInfo = ANSWERS_OFF;
  if (state?.active && !state.confirmed && isAnswerLink(token) && secret && getSupabaseEnv()) {
    try {
      const { data } = await workerRpc(secret)("worker_placed_answers_info", { p_link: token });
      answers = parseAnswersInfo(data);
    } catch {
      answers = ANSWERS_OFF;
    }
  }
  // Which button the email's link pointed at. It is only highlighted: nothing happens until it is pressed.
  const pointed = (CHOICES as readonly string[]).includes(q.a ?? "") ? (q.a as Choice) : null;
  const pointedAnswer: Pointed | null = isPointed(q.a) ? q.a : null;
  const done = (CHOICES as readonly string[]).includes(q.done ?? "") ? (q.done as Choice) : null;
  const doneAnswer: Done | null = isDone(q.done) ? q.done : null;

  return (
    <div className="min-h-dvh bg-page">
      <header className="night safe-top px-5 pb-8 pt-6 [--safe-pt:0.5rem] sm:px-8">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <div className="flex items-center gap-3">
            <Crest size={28} tone="light" />
            <span className="t-heading" style={{ fontStretch: "88%" }}>
              United Tribes
            </span>
          </div>
          <div className="rise-in flex flex-col gap-2">
            <h1 className="t-title">{state && nudge.on && !state.confirmed ? NUDGE_PAGE_WORDS.title(state.tribe.name) : state ? (state.firstName ? `${state.firstName}, your tribe` : "Your tribe") : "Your tribe"}</h1>
            {state ? <p className="t-body max-w-[44ch] text-white/80">The church placed you in {state.tribe.name}. It is yours to keep, change or ask us about.</p> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-16 pt-8 sm:px-8">
        {done === "change" && !state?.active && /^[a-f0-9]{64}$/.test(token) ? (
          <GaveUp />
        ) : doneAnswer === "notnow" && !state?.active && isAnswerLink(token) ? (
          <AnswerDone kind="notnow" again={false} window={null} />
        ) : !state ? (
          <NoPage why={why} token={token} fresh={Boolean(q.fresh)} problem={Boolean(q.problem)} invalid={Boolean(q.invalid)} />
        ) : !state.active ? (
          <Notice title="You are not in this tribe now." body="You gave up this place, or the church changed it. Open the app to look at tribes that fit you." />
        ) : (
          <Page state={state} done={done} pointed={pointed} token={token} q={q} reach={reach} nudge={nudge} answers={answers} pointedAnswer={pointedAnswer} doneAnswer={doneAnswer} />
        )}
      </main>
    </div>
  );
}

function Page({ state, done, pointed, token, q, reach, nudge, answers, pointedAnswer, doneAnswer }: { state: PlacedState; done: Choice | null; pointed: Choice | null; token: string; q: Search; reach: PlacedReach | null; nudge: NudgePageInfo; answers: AnswersInfo; pointedAnswer: Pointed | null; doneAnswer: Done | null }) {
  const t = state.tribe;
  const meets = `${dayName(t.meetingDay)}s at ${clockLabel(t.meetingTime)}, ${t.mode === "online" ? "online" : `in person${t.placeNote ? ` (${t.placeNote})` : ""}`}`;
  const picture = [
    ["Loving God", t.god],
    ["Loving others", t.others],
    ["Loving life", t.life],
  ].filter(([, v]) => v);
  const who = t.assistantFirst ? `${t.leaderFirst} and ${t.assistantFirst}` : t.leaderFirst;

  return (
    <>
      {done === "confirm" && (q.m === "whatsapp" || q.m === "email") ? (
        <div role="status" className="card rise-in flex flex-col gap-1 p-5" data-testid="placed-thanks">
          <p className="font-semibold">{q.m === "whatsapp" ? NUDGE_PAGE_WORDS.doneWhatsApp(t.name, t.leaderFirst) : NUDGE_PAGE_WORDS.doneEmail(t.name, t.leaderFirst)}</p>
          {q.m === "whatsapp" && q.c ? <p className="t-small text-soft">{NUDGE_PAGE_WORDS.confirmedNote}</p> : null}
        </div>
      ) : done === "confirm" ? (
        <p role="status" className="card rise-in p-5 font-semibold">Thank you. You are in {t.name}. Your leader is looking forward to meeting you.</p>
      ) : null}
      {doneAnswer && doneAnswer !== "notnow" ? <AnswerDone kind={doneAnswer} again={Boolean(q.again)} window={q.w ?? null} /> : null}
      {done === "withhold" ? (
        <p role="status" className="card rise-in p-5 font-semibold">
          {q.late ? "Your leader has already been given your details, so this could not be undone. Tell them if you would rather they did not use them." : "Understood. Your leader can see your name, but will not be given your email or your WhatsApp number."}
        </p>
      ) : null}
      {q.started ? <p role="alert" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">Joining for this season has closed, so this place can no longer be given up here. Ask your leader or coach.</p> : null}
      {q.problem ? <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">That didn’t save. Please try again.</p> : null}
      {q.number && nudge.on ? <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger" data-testid="placed-number-problem">{NUDGE_PAGE_WORDS.badNumber}</p> : null}
      {q.number && !nudge.on ? <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger" data-testid="placed-number-problem">{ADD_NUMBER_WORDS.badNumber} You are not in the tribe yet: fix it, or clear the box, and press Yes, I’m in again.</p> : null}

      <section className="card flex flex-col gap-3 p-6" aria-labelledby="tribe-heading">
        <h2 id="tribe-heading" className="t-heading">
          {t.name}
        </h2>
        <dl className="t-body flex flex-col gap-2">
          <Line label="Led by" value={who} />
          <Line label="Meets" value={meets} />
          <Line label="Season" value={`${t.season}, from ${t.startsOn ? formatShortDate(t.startsOn) : "its first day"}`} />
          {t.firstMeetingBy ? <Line label="First meeting by" value={formatShortDate(t.firstMeetingBy)} /> : null}
          {state.fit ? <Line label="Fit" value={`${state.fit[0].toUpperCase()}${state.fit.slice(1)} fit for what you asked for`} /> : null}
        </dl>
        {t.groupUrl ? (
          <>
            <a href={t.groupUrl} rel="noopener noreferrer" className="font-semibold underline underline-offset-4">
              Join the tribe’s WhatsApp group
            </a>
            <p className="t-small text-soft" data-testid="group-warning">{PLACED_CONTACT_WORDS.groupWarning}</p>
          </>
        ) : groupNote(state) ? (
          <p className="t-small text-soft" data-testid="group-held">{groupNote(state)}</p>
        ) : null}
      </section>

      {picture.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="picture-heading">
          <h2 id="picture-heading" className="t-heading">
            What this tribe is for
          </h2>
          <ul className="t-body flex flex-col gap-1">
            {picture.map(([label, v]) => (
              <li key={label}>
                <strong>{label}:</strong> {v}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="covenant-heading">
        <h2 id="covenant-heading" className="t-heading">
          The Tribe Covenant
        </h2>
        <ul className="t-body flex list-disc flex-col gap-1 pl-5">
          {COVENANT_PROMISES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="share-heading">
        <h2 id="share-heading" className="t-heading">
          Your details
        </h2>
        <p className="t-body text-soft" data-testid="share-line">
          {contactLine(state)}
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-label="Your answer">
        {state.confirmed ? (
          <p className="t-body font-semibold" role="status">You said yes to this tribe.</p>
        ) : nudge.on ? (
          <TwoButtons token={token} nudge={nudge} pointed={pointed === "confirm"} other={Boolean(q.other)} />
        ) : (
          <Answer token={token} choice="confirm" primary pointed={pointed === "confirm"} label="Yes, I’m in" note={PLACED_PROMISES.confirm} sentence={AGREEMENT_SENTENCE} extra={reach ? <ReachBoxes reach={reach} /> : undefined} />
        )}
        {state.canChange ? <Answer token={token} choice="change" pointed={pointed === "change"} label="Show me other tribes" note={PLACED_PROMISES.change} /> : null}
        {!state.withheld && !state.contactLate ? <Answer token={token} choice="withhold" pointed={pointed === "withhold"} label="Don’t share my details" note={PLACED_PROMISES.withhold} /> : null}
      </section>

      {!state.confirmed ? <MemberAnswers token={token} info={answers} pointed={pointedAnswer} badNumber={Boolean(q.cn)} remindIssue={q.rc === "closed" || q.rc === "too_late" ? q.rc : null} /> : null}

      <p className="t-small text-soft">
        You can also do all of this signed in, on <Link href="/tribe" className="underline underline-offset-4">your tribe page</Link>.
      </p>
    </>
  );
}

// The placed nudge's answer: two buttons that each say yes to the tribe. Only the first agrees to WhatsApp, and it says so in its own words; the number
// box is never pre-filled and nothing is ticked for them. A member who already agreed to WhatsApp and has a number is only asked to say yes.
function TwoButtons({ token, nudge, pointed, other }: { token: string; nudge: NudgePageInfo; pointed: boolean; other: boolean }) {
  const ready = nudge.yes && Boolean(nudge.number);
  const showBox = !nudge.number || other;
  return (
    <form action={placedChooseAction} className={`flex flex-col gap-3 ${pointed ? "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}`} data-testid="placed-two-buttons">
      <input type="hidden" name="token" value={token} />
      {ready && !other ? (
        <>
          <h2 className="t-heading">{NUDGE_PAGE_WORDS.nearly}</h2>
          <p className="t-body text-soft">{NUDGE_PAGE_WORDS.nearlyBody}</p>
          <Button type="submit" name="mode" value="whatsapp" variant="primary" size="lg" fullWidth>
            {NUDGE_PAGE_WORDS.yes}
          </Button>
          <p className="t-small text-soft">{PLACED_PROMISES.confirm}</p>
        </>
      ) : (
        <>
          {nudge.number && !other ? (
            <div className="flex flex-col gap-1">
              <p className="t-body" data-testid="placed-held-number">{NUDGE_PAGE_WORDS.haveNumber(nudge.number)}</p>
              <Link href={`/placed/${token}?other=1`} className="t-small min-h-11 self-start font-semibold underline underline-offset-4">
                {NUDGE_PAGE_WORDS.otherNumber}
              </Link>
            </div>
          ) : null}
          {showBox ? (
            <fieldset className="card flex flex-col gap-3 p-5" data-testid="placed-number-box">
              <legend className="sr-only">{NUDGE_PAGE_WORDS.numberLabel}</legend>
              {!nudge.number ? <p className="t-small text-soft">{NUDGE_PAGE_WORDS.noNumber}</p> : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="placed-phone" className="text-[0.95rem] font-medium">
                  {NUDGE_PAGE_WORDS.numberLabel}
                </label>
                <input
                  id="placed-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+234 803 123 4567"
                  maxLength={40}
                  className="h-14 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base text-ink hover:border-soft focus:border-ink focus:outline-none"
                />
                <p className="t-small text-soft">{NUDGE_PAGE_WORDS.numberHint}</p>
              </div>
              {nudge.signin ? (
                <label className="flex min-h-11 items-start gap-3">
                  <input type="checkbox" name="signin" className="mt-1 size-5 shrink-0 accent-[var(--crest-flame)]" data-testid="placed-signin" />
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{NUDGE_PAGE_WORDS.signinButton(nudge.signin)}</span>
                    <span className="t-small text-soft">{NUDGE_PAGE_WORDS.signinNote}</span>
                  </span>
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <Button type="submit" name="mode" value="whatsapp" variant="primary" size="lg" fullWidth data-testid="placed-yes-whatsapp">
            {NUDGE_PAGE_WORDS.whatsapp}
          </Button>
          <p className="t-small text-soft">{NUDGE_PAGE_WORDS.whatsappNote}</p>
          <Button type="submit" name="mode" value="email" variant="quiet" size="lg" fullWidth data-testid="placed-yes-email" formNoValidate>
            {NUDGE_PAGE_WORDS.email}
          </Button>
          <p className="t-small text-soft">{NUDGE_PAGE_WORDS.emailNote}</p>
        </>
      )}
    </form>
  );
}

// Why there is no page, and what to do: a link that ran out gets a fresh one by email (three a day), a place that is gone says so, a link we never
// made or a server fault says that, and never a bare "invalid".
function NoPage({ why, token, fresh, problem, invalid }: { why: LinkState | "fault"; token: string; fresh: boolean; problem: boolean; invalid: boolean }) {
  if (why === "fault") {
    return <Notice title="Something went wrong on our side." body={FRESH_LINK_WORDS.problem} />;
  }
  const words = LINK_WORDS[why === "ok" ? "unknown" : why];
  const body = why === "unknown" && invalid ? "It may have expired, or you may already have chosen another tribe. Open your tribe in the app to see where you stand." : words.body;
  return (
    <div className="card rise-in flex flex-col gap-3 p-6" role="status" data-testid="placed-nopage" data-why={why}>
      <h2 className="t-heading">{words.title}</h2>
      <p className="t-body text-soft">{body}</p>
      {fresh ? <p className="t-body font-semibold" data-testid="placed-fresh-sent">{FRESH_LINK_WORDS.sent}</p> : null}
      {problem && !fresh ? <p role="alert" className="t-body font-medium text-danger">{FRESH_LINK_WORDS.problem}</p> : null}
      {words.fresh && !fresh && /^[a-f0-9]{64}$/.test(token) ? (
        <form action={placedFreshLinkAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" variant="primary" size="lg" fullWidth data-testid="placed-fresh-link">
            {FRESH_LINK_WORDS.button}
          </Button>
        </form>
      ) : null}
      <Link href="/tribe" className="mt-1 min-h-11 font-semibold underline underline-offset-4">
        Open my tribe
      </Link>
    </div>
  );
}

// Shown after "Show me other tribes". The seat is released at that moment, so the link no longer opens the tribe; this is the answer to the
// button, and it says nothing about anyone.
function GaveUp() {
  return (
    <div className="card rise-in flex flex-col gap-3 p-6" role="status">
      <h2 className="t-heading">Done. You have given up that place.</h2>
      <p className="t-body text-soft">Nothing is lost. Sign in to see tribes that fit you and choose one.</p>
      <Link href="/tribe" className="font-semibold underline underline-offset-4">
        Look at other tribes
      </Link>
    </div>
  );
}

function Answer({ token, choice, label, note, primary = false, pointed = false, sentence, extra }: { token: string; choice: Choice; label: string; note: string; primary?: boolean; pointed?: boolean; sentence?: string; extra?: React.ReactNode }) {
  return (
    <form action={placedAction} className={`flex flex-col gap-2 ${pointed ? "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}`}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="choice" value={choice} />
      {extra}
      <Button type="submit" variant={primary ? "primary" : "quiet"} size="lg" fullWidth>
        {label}
      </Button>
      <p className="t-small text-soft">{note}</p>
      {sentence ? <p className="t-small text-soft">{sentence}</p> : null}
    </form>
  );
}

// Two optional boxes in the same form as "Yes, I’m in": a number (or the one they sign in with) and the tick for WhatsApp. Nothing here is required, and
// the tick is never pre-ticked. The number is saved before the place is confirmed; a number that does not look right stops the confirm and says so.
function ReachBoxes({ reach }: { reach: PlacedReach }) {
  const tickOnly = reach.gap === "no_yes";
  return (
    <fieldset className="card flex flex-col gap-3 p-5" data-testid="placed-reach">
      <legend className="sr-only">{PLACED_REACH_WORDS.title}</legend>
      <h3 className="font-semibold">{PLACED_REACH_WORDS.title}</h3>
      <p className="t-small text-soft">{tickOnly ? PLACED_REACH_WORDS.tickOnly : PLACED_REACH_WORDS.body}</p>
      {tickOnly ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="placed-phone" className="text-[0.95rem] font-medium">
            {ADD_NUMBER_WORDS.numberLabel}
          </label>
          <input
            id="placed-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+234 803 123 4567"
            maxLength={40}
            className="h-14 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base text-ink hover:border-soft focus:border-ink focus:outline-none"
          />
          <p className="t-small text-soft">{ADD_NUMBER_WORDS.numberHint}</p>
        </div>
      )}
      {!tickOnly && reach.signin ? (
        <label className="flex items-start gap-3">
          <input type="checkbox" name="signin" className="mt-1 size-5 shrink-0 accent-[var(--crest-flame)]" data-testid="placed-signin" />
          <span className="font-medium">{ADD_NUMBER_WORDS.signinButton(reach.signin)}</span>
        </label>
      ) : null}
      <label className="flex items-start gap-3">
        <input type="checkbox" name="whatsapp" className="mt-1 size-5 shrink-0 accent-[var(--crest-flame)]" data-testid="placed-agree" />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{ADD_NUMBER_WORDS.agree}</span>
          <span className="t-small text-soft">{ADD_NUMBER_WORDS.whoSees}</span>
        </span>
      </label>
    </fieldset>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-soft">{label}:</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card rise-in flex flex-col gap-2 p-6">
      <h2 className="t-heading">{title}</h2>
      <p className="t-body text-soft">{body}</p>
      <Link href="/tribe" className="mt-2 font-semibold underline underline-offset-4">
        Open my tribe
      </Link>
    </div>
  );
}
