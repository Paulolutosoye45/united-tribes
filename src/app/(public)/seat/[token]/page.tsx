import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { MEMBER_WORDS as W, isSeatLink, lagosWhen, parseSeatInfo, type SeatInfo } from "@/lib/seat/seat";
import { takeSeatBackAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "United Tribes",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = { done?: string; gone?: string; closed?: string; invalid?: string; problem?: string };

export default async function SeatPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let info: SeatInfo = parseSeatInfo(null);
  let fault = false;
  const secret = workerToken();
  if (isSeatLink(token) && secret && getSupabaseEnv()) {
    try {
      const { data, error } = await workerRpc(secret)("worker_seat_info", { p_link: token });
      if (error) fault = true;
      else info = parseSeatInfo(data);
    } catch {
      fault = true;
    }
  }
  // What the database says now wins over what the address says: a link opened a second time shows the truth
  const state = q.gone ? "gone" : q.closed ? "closed" : info.state;

  return (
    <div className="min-h-dvh bg-page">
      <header className="night safe-top px-5 pb-8 pt-6 [--safe-pt:0.5rem] sm:px-8">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <div className="flex items-center gap-3">
            <Crest size={28} tone="light" />
            <span className="t-heading" style={{ fontStretch: "88%" }}>{W.site}</span>
          </div>
          <h1 className="t-title rise-in">{W.title(info.first)}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-16 pt-8 sm:px-8">
        {q.problem || fault ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">{W.problem}</p>
        ) : null}
        {q.done ? <p role="status" className="card rise-in p-5 font-semibold" data-testid="seat-done">{W.back}</p> : null}
        {!info.found && !q.done && !q.gone && !q.closed ? (
          <Note text={W.invalid} testid="seat-invalid" />
        ) : state === "free" ? (
          <section className="card flex flex-col gap-4 p-6" data-testid="seat-free">
            <p className="t-body">{W.kind}</p>
            <p className="t-body">{W.free(info.tribe, info.leader, lagosWhen(info.until))}</p>
            <form action={takeSeatBackAction} className="flex flex-col gap-2">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" size="lg" fullWidth>{W.takeBack}</Button>
            </form>
          </section>
        ) : state === "back" ? (
          <Note text={W.back} testid="seat-back" />
        ) : state === "gone" ? (
          <Note text={W.gone(info.tribe)} testid="seat-gone" />
        ) : state === "closed" ? (
          <Note text={W.closed} testid="seat-closed" />
        ) : null}
      </main>
    </div>
  );
}

function Note({ text, testid }: { text: string; testid?: string }) {
  return (
    <div className="card rise-in flex flex-col gap-3 p-6" role="status" data-testid={testid}>
      <p className="t-body">{text}</p>
      <Link href="/tribe" className="min-h-11 font-semibold underline underline-offset-4">{W.signIn}</Link>
    </div>
  );
}
