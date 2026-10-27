import type { Metadata } from "next";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { DetailsFlow, type DetailsView } from "@/components/profile/DetailsFlow";
import { getSession } from "@/lib/auth/session";
import { getSupabaseEnv } from "@/lib/env";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { parseLink } from "@/lib/profile/parse";
import { loadLinkSignedIn } from "@/lib/profile/server";
import { readDetailsSession } from "@/lib/profile/session";
import type { LinkState } from "@/lib/profile/types";
import { createClient } from "@/lib/supabase/server";

// The link is a secret: keep it out of search results and out of referrer headers.
export const metadata: Metadata = {
  title: "Confirm your details",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const TOKEN = /^[a-f0-9]{64}$/;

function viewOf(state: LinkState): DetailsView {
  if (!state.found) return { mode: "ended" };
  if ("needsCode" in state && state.needsCode) return { mode: "code" };
  if ("done" in state && state.done) return { mode: "done", first: state.first, waiting: state.waiting };
  if ("key" in state) return { mode: "ask", first: state.first, key: state.key, label: state.label, question: state.question, valueLabel: state.valueLabel, options: state.options, left: state.left };
  return { mode: "ended" };
}

async function open(token: string): Promise<DetailsView> {
  // A signed-in person who owns the link answers with one tap.
  if (await getSession()) {
    const state = await loadLinkSignedIn(await createClient(), token);
    if (state.found) return viewOf(state);
    // Not their link, or no answer: the code is the way in, and proves who holds it.
  }
  const secret = workerToken();
  if (!secret) return { mode: "problem" };
  try {
    const { data, error } = await workerRpc(secret)("worker_details_info", { p_link: token, p_session: await readDetailsSession(token) });
    return error ? { mode: "problem" } : viewOf(parseLink(data));
  } catch {
    return { mode: "problem" };
  }
}

export default async function DetailsPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const view: DetailsView = TOKEN.test(token) && getSupabaseEnv() ? await open(token) : { mode: "ended" };
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
            <h1 className="t-title">{view.mode === "ask" || view.mode === "done" ? (view.first ? `Hello, ${view.first}.` : "Hello.") : "Confirm your details."}</h1>
            <p className="t-body max-w-[44ch] text-white/80">The church office keeps a few details about your tribe so that it can look after it well. Please check them. It takes under a minute, and nothing changes until you press a button.</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 pb-16 pt-8 sm:px-8">
        <DetailsFlow token={token} view={view} />
      </main>
    </div>
  );
}
