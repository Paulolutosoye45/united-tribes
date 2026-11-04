import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { ADD_NUMBER_WORDS as W, isReachLink, parsePageInfo, type PageInfo } from "@/lib/reach/series";
import { addNumberAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "Add your WhatsApp number",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = { done?: string; bad?: string; problem?: string; invalid?: string; expired?: string };

const INPUT =
  "h-14 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base text-ink hover:border-soft " +
  "focus:border-ink focus:outline-none focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)]";

export default async function AddNumberPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let info: PageInfo | null = null;
  const secret = workerToken();
  if (isReachLink(token) && secret && getSupabaseEnv()) {
    const { data } = await workerRpc(secret)("worker_reach_info", { p_link: token });
    info = parsePageInfo(data);
  }
  const title = !info ? "Add your WhatsApp number" : info.state === "form" ? (info.kind === "no_yes" ? W.yesTitle(info.first) : W.numberTitle(info.first)) : `${info.first}`;

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

      <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 pb-16 pt-8 sm:px-8">
        {!info ? (
          <Notice title={W.invalidTitle} body={W.invalidBody} />
        ) : q.done === "link" ? (
          <p role="status" className="card rise-in p-5 font-semibold" data-testid="link-sent">
            {W.linkSent}
          </p>
        ) : q.done === "email" || info.state === "email_only" ? (
          <Plain title={W.emailOnlyTitle} body={W.emailOnlyBody(info.leaderFirst)} />
        ) : info.state === "done" ? (
          <Plain title={W.doneTitle(info.first)} body={W.doneBody(info.leaderFirst)} testid="reach-done" />
        ) : info.state === "expired" || q.expired ? (
          <Expired token={token} />
        ) : (
          <Form info={info} token={token} q={q} />
        )}
      </main>
    </div>
  );
}

function Form({ info, token, q }: { info: PageInfo; token: string; q: Search }) {
  const leader = info.leaderFirst ?? "Your tribe’s leader";
  const tickOnly = info.kind === "no_yes";
  return (
    <>
      {q.done === "partial" ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium" data-testid="reach-partial">
          {W.savedNoTick}
        </p>
      ) : null}
      {q.bad ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">
          {q.bad === "signin" ? W.badSignin : W.badNumber}
        </p>
      ) : null}
      {q.problem ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">
          {W.problem}
        </p>
      ) : null}

      <p className="t-body max-w-[52ch]" data-testid="reach-body">
        {tickOnly ? W.noYesBody(leader, info.number) : W.noNumberBody(leader, info.tribe)}
      </p>

      <form action={addNumberAction} className="card flex flex-col gap-5 p-6" data-testid="reach-form">
        <input type="hidden" name="token" value={token} />
        {tickOnly ? null : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className="text-[0.95rem] font-medium">
              {W.numberLabel}
            </label>
            <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+234 803 123 4567" maxLength={40} className={INPUT} aria-describedby="phone-hint" />
            <p id="phone-hint" className="t-small text-soft">
              {W.numberHint}
            </p>
          </div>
        )}
        <label className="flex items-start gap-3">
          <input type="checkbox" name="whatsapp" className="mt-1 size-5 shrink-0 accent-[var(--crest-flame)]" data-testid="reach-agree" />
          <span className="flex flex-col gap-1">
            <span className="font-medium">{W.agree}</span>
            <span className="t-small text-soft">{W.whoSees}</span>
          </span>
        </label>
        <Button type="submit" name="intent" value="save" size="lg" fullWidth data-testid="reach-save">
          {tickOnly ? W.saveTick : W.save}
        </Button>
        {!tickOnly && info.signin ? (
          <div className="flex flex-col gap-2">
            <Button type="submit" name="intent" value="signin" variant="quiet" size="lg" fullWidth formNoValidate data-testid="reach-signin">
              {W.signinButton(info.signin)}
            </Button>
            <p className="t-small text-soft">{W.signinNote}</p>
          </div>
        ) : null}
      </form>

      <form action={addNumberAction} className="flex flex-col gap-2">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="intent" value="email" />
        <Button type="submit" variant="ghost" size="md" data-testid="reach-email">
          {W.emailInstead}
        </Button>
        <p className="t-small text-soft">{W.emailInsteadNote}</p>
      </form>
    </>
  );
}

function Expired({ token }: { token: string }) {
  return (
    <div className="card rise-in flex flex-col gap-3 p-6" data-testid="reach-expired">
      <h2 className="t-heading">{W.expiredTitle}</h2>
      <p className="t-body text-soft">{W.expiredBody}</p>
      <form action={addNumberAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="intent" value="link" />
        <Button type="submit" size="lg" fullWidth>
          {W.newLink}
        </Button>
      </form>
    </div>
  );
}

function Plain({ title, body, testid }: { title: string; body: string; testid?: string }) {
  return (
    <div className="card rise-in flex flex-col gap-3 p-6" role="status" data-testid={testid}>
      <h2 className="t-heading">{title}</h2>
      <p className="t-body text-soft">{body}</p>
      <Link href="/profile" className="font-semibold underline underline-offset-4">
        {W.profile}
      </Link>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card rise-in flex flex-col gap-2 p-6" data-testid="reach-invalid">
      <h2 className="t-heading">{title}</h2>
      <p className="t-body text-soft">{body}</p>
      <Link href="/profile" className="mt-2 font-semibold underline underline-offset-4">
        {W.profile}
      </Link>
    </div>
  );
}
