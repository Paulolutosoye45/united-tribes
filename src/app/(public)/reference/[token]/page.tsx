import type { Metadata } from "next";
import { connection } from "next/server";
import { Crest } from "@/components/brand/Crest";
import { ReferenceForm } from "@/components/leaders/ReferenceForm";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// The link is a secret: keep it out of search results and out of referrer headers.
export const metadata: Metadata = {
  title: "A reference",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Request = { applicant: string; referee: string; relationship: string; answered: boolean; expired: boolean; closed: boolean };

export default async function ReferencePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;

  let request: Request | null = null;
  if (/^[a-f0-9]{64}$/.test(token) && getSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_reference_request", { p_token: token });
    request = (data as Request | null) ?? null;
  }

  const state = !request ? "invalid" : request.answered ? "answered" : request.closed ? "closed" : request.expired ? "expired" : "open";

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
            <h1 className="t-title">{request && state === "open" ? `A reference for ${request.applicant}.` : "A reference."}</h1>
            {request && state === "open" ? (
              <p className="t-body max-w-[44ch] text-white/80">
                {request.applicant} has asked you to speak for them as they apply to lead a small group at The Covenant Nation. Four short questions, about two minutes.
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-5 pb-16 pt-8 sm:px-8">
        {state === "open" && request ? (
          <ReferenceForm token={token} applicant={request.applicant} referee={request.referee} relationship={request.relationship} />
        ) : state !== "open" ? (
          <Notice state={state} applicant={request?.applicant ?? null} />
        ) : null}
      </main>
    </div>
  );
}

function Notice({ state, applicant }: { state: "invalid" | "answered" | "closed" | "expired"; applicant: string | null }) {
  const copy = {
    invalid: { title: "This link isn’t valid.", body: "Check you copied the whole link. If it still doesn’t open, ask the person who sent it to make you a new one." },
    answered: { title: "Already sent. Thank you.", body: "Your reference has reached the review panel. You don’t need to do anything else." },
    closed: { title: "This reference is no longer needed.", body: "The application has been closed. Thank you for being willing to help." },
    expired: { title: "This link has expired.", body: `Links last 30 days. Ask ${applicant ?? "the applicant"} for a new one.` },
  }[state];
  return (
    <div className="card rise-in flex flex-col gap-2 p-6">
      <h2 className="t-heading">{copy.title}</h2>
      <p className="t-body text-soft">{copy.body}</p>
    </div>
  );
}
