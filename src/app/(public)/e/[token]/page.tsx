import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Crest } from "@/components/brand/Crest";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ASKS, NOT_SEASON_REASONS } from "@/lib/outreach/labels";
import { openLink, type LinkInfo } from "@/lib/outreach/link";
import { confirmAction, prefsAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = { title: "United Tribes", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Q = { done?: string; saved?: string; problem?: string };

export default async function EmailLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Q> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;
  const info = await openLink(token);

  // The big button in an email: straight back to where they stopped. The sign-in page, when needed, brings them on to it.
  if (info?.found && info.kind === "go" && !info.expired && info.scope) redirect(info.scope);

  const first = info?.first_name ? `${info.first_name}, ` : "";
  return (
    <Frame title={heading(info, q, first)}>
      {!info?.found ? (
        <Gone title="This link isn’t valid." body="Check you opened the whole link from the email. You can always sign in and carry on from your home page." />
      ) : info.kind === "go" ? (
        <Gone title="This link has expired." body="Sign in and you will find everything exactly where you left it." />
      ) : info.expired && q.done !== "1" && q.saved !== "1" ? (
        <Gone title="This link has expired." body="For your safety, links in emails stop working after a while. Sign in and you can change what we send you from your profile." />
      ) : info.kind === "stop" ? (
        <StopCard token={token} info={info} q={q} />
      ) : info.kind === "ask" ? (
        <AskCard token={token} info={info} q={q} />
      ) : (
        <PrefsCard token={token} info={info} q={q} />
      )}
    </Frame>
  );
}

function heading(info: LinkInfo | null, q: Q, first: string): string {
  if (!info?.found) return "This link isn’t valid";
  if (info.kind === "stop") return q.done ? "You’re all set" : `${first}stop these emails?`;
  if (info.kind === "prefs") return q.saved ? "Saved" : "What would you like from us?";
  if (info.kind === "ask") {
    const ask = ASKS[info.scope ?? ""];
    return q.done ? "Thank you" : ask ? `${first}${ask.title.charAt(0).toLowerCase()}${ask.title.slice(1)}` : "Thank you";
  }
  return "United Tribes";
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
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
          <h1 className="t-title rise-in">{title}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 pb-16 pt-8 sm:px-8">{children}</main>
    </div>
  );
}

function Problem({ q }: { q: Q }) {
  if (!q.problem) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">
      {q.problem === "expired" ? "This link has expired. Sign in and change it from your profile." : "That didn’t save. Please try again, or sign in and change it from your profile."}
    </p>
  );
}

function Gone({ title, body }: { title: string; body: string }) {
  return (
    <div className="card rise-in flex flex-col gap-3 p-6">
      <h2 className="t-heading">{title}</h2>
      <p className="t-body text-soft">{body}</p>
      <Link href="/sign-in" className={buttonClasses({ variant: "primary" })}>
        Sign in
      </Link>
    </div>
  );
}

function Hint({ info }: { info: LinkInfo }) {
  return info.email_hint ? <p className="t-small text-soft">For {info.email_hint}</p> : null;
}

function StopCard({ token, info, q }: { token: string; info: LinkInfo; q: Q }) {
  const announcements = info.scope === "announcements";
  if (q.done) {
    return (
      <div className="card rise-in flex flex-col gap-3 p-6" role="status">
        <h2 className="t-heading">{announcements ? "No more announcements." : "No more reminders."}</h2>
        <p className="t-body text-soft">
          We have stopped them. Messages that matter to your own tribe, like meeting times, still reach you. You can change any of this in your profile.
        </p>
        <Link href="/profile" className="font-semibold underline underline-offset-4">
          Open my profile
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Problem q={q} />
      <div className="card rise-in flex flex-col gap-3 p-6">
        <p className="t-body">
          {announcements
            ? "We will stop sending you announcements from the church office."
            : "We will stop sending you reminders about finishing your form, your application or getting started."}
        </p>
        <p className="t-small text-soft">Messages about your own tribe, like meeting times, are separate and carry on.</p>
        <Hint info={info} />
        <form action={confirmAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <Button type="submit" size="lg" fullWidth>
            Yes, stop them
          </Button>
        </form>
        <Link href="/home" className="t-small text-center font-semibold underline underline-offset-4">
          No, keep them
        </Link>
      </div>
    </div>
  );
}

function AskCard({ token, info, q }: { token: string; info: LinkInfo; q: Q }) {
  const ask = ASKS[info.scope ?? ""];
  if (!ask) return <Gone title="This link isn’t valid." body="Sign in and carry on from your home page." />;
  if (q.done) {
    return (
      <div className="card rise-in flex flex-col gap-3 p-6" role="status">
        <h2 className="t-heading">{ask.done}</h2>
        <Link href="/home" className="font-semibold underline underline-offset-4">
          Go to my home page
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Problem q={q} />
      <div className="card rise-in flex flex-col gap-4 p-6">
        <p className="t-body">{ask.body}</p>
        <form action={confirmAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          {ask.reasons ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="t-small mb-1 text-soft">Why? (optional)</legend>
              {NOT_SEASON_REASONS.map((r) => (
                <label key={r.value} className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-line px-4 py-2">
                  <input type="radio" name="reason" value={r.value} className="size-4 accent-[var(--flame)]" />
                  <span className="t-body">{r.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button type="submit" size="lg" fullWidth>
            {ask.confirm}
          </Button>
        </form>
        <Link href="/home" className="t-small text-center font-semibold underline underline-offset-4">
          Not now
        </Link>
      </div>
    </div>
  );
}

const SWITCHES = [
  { name: "reminders", title: "Reminders", note: "A gentle nudge if you start your form or application and get busy, or a tribe is waiting for you." },
  { name: "announcements", title: "Announcements", note: "News from the church office, now and then." },
  { name: "tribe", title: "My tribe", note: "Meeting times, your weekly check-in and anything from your leader. Turning this off turns off all email about your tribe." },
] as const;

function PrefsCard({ token, info, q }: { token: string; info: LinkInfo; q: Q }) {
  const s = info.switches ?? { reminders: true, announcements: true, tribe: true };
  return (
    <div className="flex flex-col gap-4">
      <Problem q={q} />
      {q.saved ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">
          Saved. Thank you for telling us.
        </p>
      ) : null}
      <form action={prefsAction} className="card rise-in flex flex-col gap-5 p-6">
        <input type="hidden" name="token" value={token} />
        <Hint info={info} />
        {SWITCHES.map((sw) => (
          <label key={sw.name} className="flex items-start gap-4">
            <input type="checkbox" name={sw.name} defaultChecked={s[sw.name]} className="mt-1 size-5 shrink-0 accent-[var(--flame)]" />
            <span className="flex flex-col gap-1">
              <span className="t-heading">{sw.title}</span>
              <span className="t-small text-soft">{sw.note}</span>
            </span>
          </label>
        ))}
        <Button type="submit" size="lg" fullWidth>
          Save
        </Button>
      </form>
    </div>
  );
}
