import type { Metadata } from "next";
import Image from "next/image";
import { SignInPanel } from "@/components/auth/SignInPanel";
import { Crest } from "@/components/brand/Crest";
import { safeNext } from "@/lib/auth/redirect";
import { getSupabaseEnv } from "@/lib/env";
import { currentChannel } from "@/lib/signin/deps";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string; error?: string; ended?: string }>;

const PROMISES = [
  "Tell us your season in about five minutes",
  "See your three best-fit tribes, each with its own score",
  "Grow with up to eleven others for twelve weeks",
];

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const linkError =
    params.error === "link"
      ? "That sign-in link didn't work or has expired. Sign in again below."
      : null;

  // How WhatsApp codes stand right now (on, paused, off), read fresh on every visit.
  const channel = getSupabaseEnv() ? await currentChannel() : undefined;

  return (
    <main className="min-h-dvh bg-night lg:grid lg:grid-cols-[1.15fr_1fr] lg:bg-page">
      <section className="night safe-top flex flex-col justify-between gap-12 px-6 pb-16 [--safe-pt:2.5rem] sm:px-12 lg:min-h-dvh lg:px-16 lg:pb-16 lg:[--safe-pt:3.5rem]">
        <div
          aria-hidden="true"
          className="glow-breathe pointer-events-none absolute -right-24 -top-24 -z-10 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(tribe,rgb(244_196_67/0.28),rgb(232_104_56/0.18)_45%,transparent_70%)] blur-2xl"
        />

        <div className="flex items-center justify-between">
          <Crest size={64} animate tone="light" title="United Tribes" className="drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)] lg:h-auto lg:w-24" />
          <p className="t-small hidden rounded-full border border-white/15 px-3 py-1 text-white/75 sm:block lg:hidden">
            The Covenant Nation
          </p>
        </div>

        <div className="flex max-w-2xl flex-col gap-6">
          <h1 className="t-hero rise-in">
            Find your people.
            <br />
            <span className="text-gold">Grow together.</span>
          </h1>
          <p className="t-body max-w-[38ch] text-white/75 rise-in" style={{ animationDelay: "120ms" }}>
            Small tribes of up to twelve, built around the season you are in and the goal you are after.
          </p>

          <ul className="stagger mt-2 hidden flex-col gap-3 lg:flex">
            {PROMISES.map((p, i) => (
              <li key={p} style={{ ["--i" as string]: i + 3 }} className="flex items-center gap-3 text-white/85">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[0.8rem] font-semibold text-gold">
                  {i + 1}
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative -mt-8 flex flex-col justify-between gap-10 rounded-t-[var(--radius-sheet)] bg-page px-6 pb-8 pt-9 shadow-[0_-24px_48px_-24px_rgb(0_0_0/0.5)] sm:px-12 lg:mt-0 lg:min-h-dvh lg:justify-center lg:rounded-none lg:px-16 lg:shadow-none">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          {params.ended === "1" ? (
            <p role="status" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">
              That account is no longer here, so you have been signed out. To use United Tribes again, sign in below and start afresh.
            </p>
          ) : null}
          {getSupabaseEnv() ? <SignInPanel next={next} initialError={linkError} channel={channel} /> : <SetupNotice />}
        </div>

        <footer className="mx-auto flex w-full max-w-md items-center gap-3 text-soft">
          <Image src="/brand/tcn-logo.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
          <p className="t-small">
            A ministry of The Covenant Nation. We use your email or WhatsApp number only to sign you in and to reach you about your tribe.
          </p>
        </footer>
      </section>
    </main>
  );
}

function SetupNotice() {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <h2 className="t-heading">Sign-in is not set up yet</h2>
      <p className="t-small text-soft">
        Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
        <code>.env.local</code>, then restart the app. The README walks through it in ten minutes.
      </p>
    </div>
  );
}
