"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshMatchesAction, starterListAction } from "@/app/(app)/circle/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import type { MyMatch } from "@/lib/matching/types";
import { formatDate } from "@/lib/dates";
import { MatchCard } from "./MatchCard";

export function MatchList({ match }: { match: MyMatch }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"refresh" | "starter" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = match.circles.length;

  async function run(kind: "refresh" | "starter", action: () => ReturnType<typeof refreshMatchesAction>) {
    setBusy(kind);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  const title = count === 3 ? "Three Tribes that fit you" : count > 0 ? (count === 1 ? "One Tribe fits you well" : `${count} Tribes fit you well`) : "No Tribe fits you well yet";

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="t-title">{title}</h1>
        <p className="t-body measure text-soft">
          {count > 0
            ? `Each percentage is for that Tribe alone, so two Tribes can both score high. Choose the one you want to walk with for twelve weeks${match.season ? `, starting ${formatDate(match.season.starts_on)}` : ""}.`
            : "Tribes are built by leaders who have finished their training. As more open, they will appear here."}
        </p>
      </header>

      {count > 0 ? (
        <div className="stagger grid gap-5 lg:grid-cols-3 lg:items-stretch">
          {match.circles.map((shown, i) => (
            <MatchCard key={shown.circle.id} shown={shown} featured={i === 0} index={i} />
          ))}
        </div>
      ) : null}

      {match.short ? (
        <section aria-labelledby="starter-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
          <div className="flex flex-col gap-2">
            <h2 id="starter-heading" className="t-heading">
              {count === 0 ? "Join the Starter Tribe list" : "Want more to choose from?"}
            </h2>
            <p className="t-body measure text-soft">
              {count === 0
                ? "We have noted the goal, stage of life and meeting times you asked for, so the team can look for a leader to serve you."
                : "We could not find three strong fits, and we have noted what you are looking for so the team can find a leader for it."}{" "}
              A Starter Tribe is a small, welcoming group while a better-fitting Tribe is found. Joining the list tells us you want a place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {match.on_starter_list ? (
              <>
                <p className="t-body font-semibold">You are on the list.</p>
                <Button variant="quiet" size="md" loading={busy === "starter"} onClick={() => void run("starter", () => starterListAction(false))}>
                  Take me off
                </Button>
              </>
            ) : (
              <Button variant="solid" size="md" loading={busy === "starter"} onClick={() => void run("starter", () => starterListAction(true))}>
                Put me on the Starter Tribe list
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="how-heading" className="flex flex-col gap-4">
        <h2 id="how-heading" className="t-heading">
          Not what you hoped for?
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="quiet" size="md" loading={busy === "refresh"} onClick={() => void run("refresh", refreshMatchesAction)}>
            Look again
          </Button>
          <Link href="/join?edit=1" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Change my answers</span>
          </Link>
        </div>
        <details className="group rounded-[var(--radius-card)] border border-line bg-raised px-5">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
            <span>How the percentage is worked out</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 transition-transform duration-300 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 8l5 5 5-5" />
            </svg>
          </summary>
          <div className="t-body measure flex flex-col gap-3 pb-5 text-soft">
            <p>
              We only look at Tribes you could actually join: your stage of life, a time you can meet, a format that works for you, a group that is right for you and a seat that is free. Then each one is scored on seven things, most important first: your Season Goal, your stage of life, your tribe, where it meets, how you like to work, the rhythm of the week and your stage of faith.
            </p>
            <p>The score is a guide, never a verdict. Read the reasons, read the leader’s story and choose the Tribe you want to be in.</p>
            <p>Your answers stay with us. A leader sees only your name, and your WhatsApp number if you agreed, once you have joined.</p>
          </div>
        </details>
      </section>
    </div>
  );
}
