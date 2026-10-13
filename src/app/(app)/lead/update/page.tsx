import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UpdateAnswers } from "@/components/leaders/UpdateAnswers";
import { requireSession } from "@/lib/auth/session";
import { loadMyApplication } from "@/lib/leaders/server";
import { notedFields, readFirstCheckStatus } from "@/lib/leaders/quality/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add to your answers" };

// Each changed answer is checked with an AI service while the person waits.
export const maxDuration = 60;

const lagos = (iso: string) =>
  new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(iso));

export default async function UpdateAnswersPage() {
  const session = await requireSession("/lead/update");
  const supabase = await createClient();
  const { application } = await loadMyApplication(supabase, session.person.id);
  if (!application || application.status === "draft" || application.status === "ineligible") redirect("/lead");

  const status = readFirstCheckStatus((await supabase.rpc("leader_ai_status", { p_app: application.id })).data);
  // Only while the first check is asking for more, and only for the answers it asked about.
  if (!status || status.mode !== "on" || status.state !== "strengthen") redirect("/lead");

  const fields = notedFields(status.notes);
  const items = fields.map((field) => ({
    field,
    note: status.notes[field] ?? "",
    current: String(application.answers.calling[field] ?? ""),
  }));

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/lead" className="t-small text-soft underline-offset-4 hover:underline">
          ← Your application
        </Link>
        <h1 className="t-title">Add to your answers</h1>
        <p className="t-body text-soft">
          Say it in your own words. A few more sentences, with one real detail, is all it takes. You can change only the answers below.
        </p>
      </header>
      <UpdateAnswers
        appId={application.id}
        items={items}
        minWords={status.minWords}
        rewritesLeft={status.rewritesLeft}
        lockedUntil={status.canRewriteNow || !status.nextRewriteAt ? null : lagos(status.nextRewriteAt)}
      />
    </div>
  );
}
