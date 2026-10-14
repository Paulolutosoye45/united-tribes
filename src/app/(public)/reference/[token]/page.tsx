import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { RefereeFlow } from "@/components/leaders/RefereeFlow";
import { getSupabaseEnv } from "@/lib/env";
import { readRefereeOpen } from "@/lib/leaders/referee/read";
import { readRefereeSession } from "@/lib/leaders/referee/session";
import { BROWSER_COOKIE, isLinkRobot, traceOf } from "@/lib/leaders/referee/trace";
import { createClient } from "@/lib/supabase/server";

// The link is a secret: keep it out of search results and out of referrer headers.
export const metadata: Metadata = {
  title: "A reference",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ReferencePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const valid = /^[a-f0-9]{64}$/.test(token) && getSupabaseEnv();

  const h = await headers();
  const info = valid
    ? await (async () => {
        const supabase = await createClient();
        const trace = traceOf(h, (await cookies()).get(BROWSER_COOKIE)?.value);
        // A program drawing a preview of the link (WhatsApp does this when it is sent) is not the referee opening it
        const { data } = await supabase.rpc("referee_open", {
          p_token: token,
          p_session: await readRefereeSession(token),
          p_net: trace.net,
          p_bid: trace.bid,
          p_record: !isLinkRobot(h.get("user-agent")),
        });
        return readRefereeOpen(data);
      })()
    : ({ state: "invalid" } as const);

  const live = info.state === "open" ? info : null;
  const reverify = live?.mode === "reverify";
  const title = !live ? "A reference." : reverify ? "Was this reference yours?" : `A reference for ${live.applicant}.`;

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
            <h1 className="t-title">{title}</h1>
            {live ? (
              <p className="t-body max-w-[44ch] text-white/80">
                {reverify
                  ? `You gave a reference for ${live.applicant}, who is applying to lead a small group at The Covenant Nation. We are checking that it was really you who sent it.`
                  : `${live.applicant} has asked you to speak for them as they apply to lead a small group at The Covenant Nation. Four short questions, about two minutes.`}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-5 pb-16 pt-8 sm:px-8">
        <RefereeFlow token={token} info={info} />
      </main>
    </div>
  );
}
