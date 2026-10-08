import type { Metadata } from "next";
import { IntakeFlow, type View } from "@/components/intake/IntakeFlow";
import { JoinedView } from "@/components/intake/JoinedView";
import { AppShell } from "@/components/shell/AppShell";
import { providerFromEnv } from "@/lib/ai/suggest";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { parseDraftAnswers, type Answers } from "@/lib/intake/answers";
import { loadCatalogue, profileToAnswers } from "@/lib/intake/server";
import { isStepId } from "@/lib/intake/steps";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Find my circle" };

type SearchParams = Promise<{ edit?: string }>;

export default async function JoinPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession("/join");
  const { edit } = await searchParams;
  const supabase = await createClient();

  const [{ catalogue, ids }, profile, draft, matching, aiConsent, season] = await Promise.all([
    loadCatalogue(supabase),
    supabase.from("member_profiles").select("*").eq("person_id", session.person.id).maybeSingle(),
    supabase.from("intake_drafts").select("step, answers, active_seconds").eq("person_id", session.person.id).maybeSingle(),
    supabase.rpc("has_consent", { p_purpose: "matching" }),
    supabase.rpc("has_consent", { p_purpose: "ai_assist" }),
    supabase
      .from("seasons")
      .select("name, starts_on")
      .in("status", ["planning", "open"])
      .order("starts_on", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const aiAvailable = providerFromEnv() !== null;
  const hasMatchingConsent = matching.data === true;
  const seasonName = season.data?.name ?? null;
  const seasonStarts = season.data?.starts_on ? formatDate(season.data.starts_on) : null;
  const editing = edit === "1" && Boolean(profile.data) && hasMatchingConsent;

  // Already finished: show where things stand, with a way to change answers.
  if (profile.data && !editing) {
    const answers = profileToAnswers(profile.data, ids, {
      preferredName: session.person.preferredName,
      fullName: session.person.fullName,
    });
    return (
      <AppShell session={session}>
        <JoinedView answers={answers} catalogue={catalogue} seasonName={seasonName} seasonStarts={seasonStarts} />
      </AppShell>
    );
  }

  let view: View;
  let answers: Answers;
  let activeSeconds = 0;

  if (editing && profile.data) {
    view = "review";
    answers = profileToAnswers(profile.data, ids, {
      preferredName: session.person.preferredName,
      fullName: session.person.fullName,
    });
  } else if (draft.data && hasMatchingConsent) {
    answers = parseDraftAnswers(draft.data.answers);
    view = isStepId(draft.data.step) ? draft.data.step : "age";
    activeSeconds = Number(draft.data.active_seconds) || 0;
  } else {
    answers = {};
    view = hasMatchingConsent ? "age" : "welcome";
  }

  // Start from how the person is already known.
  if (!answers.preferredName && session.person.preferredName) answers.preferredName = session.person.preferredName;
  if (!answers.fullName && session.person.fullName) answers.fullName = session.person.fullName;

  return (
    <IntakeFlow
      personId={session.person.id}
      catalogue={catalogue}
      aiAvailable={aiAvailable}
      seasonName={seasonName}
      seasonStarts={seasonStarts}
      initial={{ view, answers, activeSeconds, ai: aiConsent.data === true, isEdit: editing }}
    />
  );
}
