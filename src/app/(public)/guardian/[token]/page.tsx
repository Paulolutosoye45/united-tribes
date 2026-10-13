import type { Metadata } from "next";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { GuardianForm } from "@/components/guardian/GuardianForm";
import { getSupabaseEnv } from "@/lib/env";
import { loadGuardianRequest } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

// The link is a secret: keep it out of search results and out of referrer headers.
export const metadata: Metadata = {
  title: "Permission for a young person",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function GuardianPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;

  let request = null;
  if (/^[a-f0-9]{64}$/.test(token) && getSupabaseEnv()) {
    const supabase = await createClient();
    request = await loadGuardianRequest(supabase, token);
  }

  // What the page offers depends on where the request stands.
  const mode = !request
    ? "invalid"
    : request.status === "requested"
      ? request.expired
        ? "expired"
        : "ask"
      : request.status === "approved"
        ? "approved"
        : request.status; // declined | withdrawn

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
            <h1 className="t-title">{request && mode === "ask" ? `${request.teen_first} would like to join a tribe.` : "Permission for a young person."}</h1>
            {request && mode === "ask" ? (
              <p className="t-body max-w-[44ch] text-white/80">
                {request.teen_first} has asked for your permission to take part in United Tribes at The Covenant Nation. Please read this, then say yes or no.
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-5 pb-16 pt-8 sm:px-8">
        {request && (mode === "ask" || mode === "approved") ? (
          <GuardianForm token={token} request={request} mode={mode} />
        ) : (
          <Notice mode={mode as "invalid" | "expired" | "declined" | "withdrawn"} teen={request?.teen_first ?? null} />
        )}
      </main>
    </div>
  );
}

function Notice({ mode, teen }: { mode: "invalid" | "expired" | "declined" | "withdrawn"; teen: string | null }) {
  const who = teen ?? "the young person";
  const copy = {
    invalid: {
      title: "This link isn’t valid.",
      body: "Check you copied the whole link. If it still doesn’t open, ask the young person to send you a new one.",
    },
    expired: {
      title: "This link has expired.",
      body: `Links last 14 days. Ask ${who} to send you a new one from their United Tribes page.`,
    },
    declined: {
      title: "You said no. Thank you for letting us know.",
      body: `${who} will not be placed in a tribe. If you change your mind, speak to ${who}, who can ask the Care Team of The Covenant Nation to open this again.`,
    },
    withdrawn: {
      title: "Your permission has been taken back.",
      body: `${who} has left their tribe and will not be placed in another. If you change your mind, speak to ${who}, who can ask the Care Team of The Covenant Nation to open this again.`,
    },
  }[mode];
  return (
    <div className="card rise-in flex flex-col gap-2 p-6">
      <h2 className="t-heading">{copy.title}</h2>
      <p className="t-body text-soft">{copy.body}</p>
    </div>
  );
}
