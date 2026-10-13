import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { Button } from "@/components/ui/Button";
import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { replyAction } from "./actions";

// The link is a secret: keep it out of search results and referrer headers.
export const metadata: Metadata = {
  title: "Your Friday check-in",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Info = { found: boolean; first_name?: string; week?: number; step_set?: boolean; when?: string; will?: string; outcome?: string | null; open?: boolean; closed?: boolean };

const CHOICES = [
  { value: "done", label: "Done", note: "I did my step." },
  { value: "partly", label: "Partly", note: "I made a start." },
  { value: "not_yet", label: "Not yet", note: "It didn’t happen this week." },
] as const;

const WORDS: Record<string, string> = { done: "Done", partly: "Partly", not_yet: "Not yet" };

export default async function ReplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ o?: string; saved?: string; problem?: string; late?: string }>;
}) {
  await connection();
  const { token } = await params;
  const q = await searchParams;

  let info: Info | null = null;
  const secret = workerToken();
  if (/^[a-f0-9]{64}$/.test(token) && secret && getSupabaseEnv()) {
    const { data } = await workerRpc(secret)("worker_reply_info", { p_reply_token: token });
    info = (data as Info | null) ?? null;
  }
  const found = info?.found === true;
  const saved = q.saved && WORDS[q.saved] ? q.saved : null;
  const chosen = q.o && WORDS[q.o] ? q.o : null;

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
            <h1 className="t-title">{found && info?.first_name ? `${info.first_name}, how did your week go?` : "Your Friday check-in"}</h1>
            {found && info?.will ? (
              <p className="t-body max-w-[44ch] text-white/80">
                Your step: when {String(info.when ?? "").replace(/^when\s+/i, "")}, I will {info.will}.
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-5 pb-16 pt-8 sm:px-8">
        {!found ? (
          <Notice
            title="This link isn’t valid."
            body="Check you opened the whole link. If it still doesn’t work, open your week in the app and answer there."
          />
        ) : saved ? (
          <div className="card rise-in flex flex-col gap-3 p-6" role="status">
            <h2 className="t-heading">Thank you. Marked “{WORDS[saved]}”.</h2>
            <p className="t-body text-soft">Your leader will see it. If God did something this week, you can share a short testimony in the app.</p>
            <Link href="/rhythm" className="font-semibold underline underline-offset-4">
              Open my week
            </Link>
          </div>
        ) : info?.closed ? (
          <Notice title="This check-in has closed." body="You can still tell your tribe how it went when you meet. Open your week in the app to see what’s next." />
        ) : info && info.open === false ? (
          <Notice title="Check-in opens on Friday." body="Come back then. It takes one tap." />
        ) : (
          <div className="flex flex-col gap-4">
            {q.problem ? (
              <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 font-medium text-danger">
                That didn’t save. Please try again, or open your week in the app.
              </p>
            ) : null}
            {q.late ? <p role="alert" className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium">This week’s check-in is no longer open.</p> : null}
            {info?.outcome ? (
              <p className="t-small text-soft">
                You marked this week “{WORDS[info.outcome] ?? info.outcome}”. You can change your answer below.
              </p>
            ) : null}
            <p className="t-body text-soft">One tap is enough. Did you do your step?</p>
            <div className="stagger flex flex-col gap-3">
              {CHOICES.map((c) => (
                <form key={c.value} action={replyAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="outcome" value={c.value} />
                  <Button type="submit" variant={chosen === c.value ? "primary" : "quiet"} size="lg" fullWidth>
                    <span className="flex flex-col items-start leading-tight">
                      <span>{c.label}</span>
                      <span className="t-small font-normal opacity-80">{c.note}</span>
                    </span>
                  </Button>
                </form>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card rise-in flex flex-col gap-2 p-6">
      <h2 className="t-heading">{title}</h2>
      <p className="t-body text-soft">{body}</p>
      <Link href="/rhythm" className="mt-2 font-semibold underline underline-offset-4">
        Open my week
      </Link>
    </div>
  );
}
