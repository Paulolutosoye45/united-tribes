import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { clockLabel, dayName } from "@/lib/academy/options";
import { getSupabaseEnv } from "@/lib/env";
import { formatShortDate } from "@/lib/dates";
import { AGREEMENT_SENTENCE, COVENANT_PROMISES } from "@/lib/matching/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { contactLine, groupNote } from "@/lib/placement/placed";
import { parsePlaced, type PlacedState } from "@/lib/placement/types";
import { PLACED_CONTACT_WORDS, PLACED_PROMISES } from "@/lib/placement/wording";
import { placedAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "Your tribe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = { a?: string; done?: string; late?: string; started?: string; invalid?: string; problem?: string };

const CHOICES = ["confirm", "change", "withhold"] as const;
type Choice = (typeof CHOICES)[number];

export default async function PlacedPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let state: PlacedState | null = null;
  const secret = workerToken();
  if (/^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    const { data } = await workerRpc(secret)("worker_placed_info", { p_link: token });
    state = parsePlaced(data);
  }
  // Which button the email's link pointed at. It is only highlighted: nothing happens until it is pressed.
  const pointed = (CHOICES as readonly string[]).includes(q.a ?? "") ? (q.a as Choice) : null;
  const done = (CHOICES as readonly string[]).includes(q.done ?? "") ? (q.done as Choice) : null;

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
            <h1 className="t-title">{state ? (state.firstName ? `${state.firstName}, your tribe` : "Your tribe") : "Your tribe"}</h1>
            {state ? <p className="t-body max-w-[44ch] text-white/80">The church placed you in {state.tribe.name}. It is yours to keep, change or ask us about.</p> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-16 pt-8 sm:px-8">
        {done === "change" && !state?.active && /^[a-f0-9]{64}$/.test(token) ? (
          <GaveUp />
        ) : !state ? (
          <Notice
            title="This link isn’t valid."
            body={q.invalid ? "It may have expired, or you may already have chosen another tribe. Open your tribe in the app to see where you stand." : "Check you opened the whole link. If it still doesn’t work, open your tribe in the app."}
          />
        ) : !state.active ? (
          <Notice title="You are not in this tribe now." body="You gave up this place, or the church changed it. Open the app to look at tribes that fit you." />
        ) : (
          <Page state={state} done={done} pointed={pointed} token={token} q={q} />
        )}
      </main>
    </div>
  );
}

function Page({ state, done, pointed, token, q }: { state: PlacedState; done: Choice | null; pointed: Choice | null; token: string; q: Search }) {
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
      {done === "confirm" ? (
        <p role="status" className="card rise-in p-5 font-semibold">Thank you. You are in {t.name}. Your leader is looking forward to meeting you.</p>
      ) : null}
      {done === "withhold" ? (
        <p role="status" className="card rise-in p-5 font-semibold">
          {q.late ? "Your leader has already been given your details, so this could not be undone. Tell them if you would rather they did not use them." : "Understood. Your leader can see your name, but will not be given your email or your WhatsApp number."}
        </p>
      ) : null}
      {q.started ? <p role="alert" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">Joining for this season has closed, so this place can no longer be given up here. Ask your leader or coach.</p> : null}
      {q.problem ? <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">That didn’t save. Please try again.</p> : null}

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
        ) : (
          <Answer token={token} choice="confirm" primary pointed={pointed === "confirm"} label="Yes, I’m in" note={PLACED_PROMISES.confirm} sentence={AGREEMENT_SENTENCE} />
        )}
        {state.canChange ? <Answer token={token} choice="change" pointed={pointed === "change"} label="Show me other tribes" note={PLACED_PROMISES.change} /> : null}
        {!state.withheld && !state.contactLate ? <Answer token={token} choice="withhold" pointed={pointed === "withhold"} label="Don’t share my details" note={PLACED_PROMISES.withhold} /> : null}
      </section>

      <p className="t-small text-soft">
        You can also do all of this signed in, on <Link href="/tribe" className="underline underline-offset-4">your tribe page</Link>.
      </p>
    </>
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

function Answer({ token, choice, label, note, primary = false, pointed = false, sentence }: { token: string; choice: Choice; label: string; note: string; primary?: boolean; pointed?: boolean; sentence?: string }) {
  return (
    <form action={placedAction} className={`flex flex-col gap-2 ${pointed ? "rounded-[var(--radius-control)] ring-2 ring-gold ring-offset-4 ring-offset-page" : ""}`}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="choice" value={choice} />
      <Button type="submit" variant={primary ? "primary" : "quiet"} size="lg" fullWidth>
        {label}
      </Button>
      <p className="t-small text-soft">{note}</p>
      {sentence ? <p className="t-small text-soft">{sentence}</p> : null}
    </form>
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
