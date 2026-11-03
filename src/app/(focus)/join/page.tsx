import type { Metadata } from "next";
import { HowToPilot } from "@/components/guides/HowToPilot";
import { IntakeFlow, type View } from "@/components/intake/IntakeFlow";
import { JoinedView } from "@/components/intake/JoinedView";
import { AppShell } from "@/components/shell/AppShell";
import { speechFromEnv } from "@/lib/ai/stt";
import { providerFromEnv } from "@/lib/ai/suggest";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { parseDraftAnswers, type Answers } from "@/lib/intake/answers";
import { loadCatalogue, openSealedDraft, profileToAnswers } from "@/lib/intake/server";
import { resumeStep } from "@/lib/intake/steps";
import { pilotFor } from "@/lib/guides/pilot";
import { readContact } from "@/lib/messaging/contact";
import { parseNumberRule } from "@/lib/messaging/number-rule";
import { loadJoinSeason } from "@/lib/placement/season";
import { loadMyGuardian } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Find my tribe" };

type SearchParams = Promise<{ edit?: string }>;

export default async function JoinPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession("/join");
  const { edit } = await searchParams;
  const supabase = await createClient();

  // Their own answers first: a community or goal they chose that has since been retired is still shown to them.
  const profile = await supabase.from("member_profiles").select("*").eq("person_id", session.person.id).maybeSingle();
  const [{ catalogue, ids }, draft, matching, aiConsent, season, contactRaw, numberRaw] = await Promise.all([
    loadCatalogue(supabase, { keep: [profile.data?.community_id, profile.data?.second_community_id, profile.data?.season_goal_id] }),
    supabase.from("intake_drafts").select("step, answers, active_seconds, sealed").eq("person_id", session.person.id).maybeSingle(),
    supabase.rpc("has_consent", { p_purpose: "matching" }),
    supabase.rpc("has_consent", { p_purpose: "ai_assist" }),
    loadJoinSeason(supabase),
    supabase.rpc("my_contact"),
    // Whether the church has made the phone number compulsory. Off (or the database not having it yet), nothing changes.
    supabase.rpc("my_number_rule"),
  ]);

  const contact = readContact(contactRaw.data);
  const numberRequired = parseNumberRule(numberRaw.data).on;
  const aiAvailable = providerFromEnv() !== null;
  const voiceAvailable = speechFromEnv() !== null;
  const hasMatchingConsent = matching.data === true;
  const seasonName = season?.name ?? null;
  const seasonStarts = season?.startsOn ? formatDate(season.startsOn) : null;
  // A season already under way (inside its joining window): the pages say so instead of "starts on"
  const seasonRunning = season?.started === true;
  const editing = edit === "1" && Boolean(profile.data) && hasMatchingConsent;

  // Already finished: show where things stand, with a way to change answers.
  if (profile.data && !editing) {
    const answers = profileToAnswers(profile.data, ids, {
      preferredName: session.person.preferredName,
      fullName: session.person.fullName,
    }, contact);
    const guardian = await loadMyGuardian(supabase);
    return (
      <AppShell session={session}>
        <JoinedView
          answers={answers}
          catalogue={catalogue}
          seasonName={seasonName}
          seasonStarts={seasonStarts}
      seasonRunning={seasonRunning}
          teen={guardian.needed && guardian.state !== "ready"}
        />
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
    }, contact);
  } else if (draft.data && hasMatchingConsent) {
    answers = { ...parseDraftAnswers(draft.data.answers), ...openSealedDraft(draft.data.sealed as string | null, session.person.id) };
    view = resumeStep(draft.data.step) ?? "age";
    activeSeconds = Number(draft.data.active_seconds) || 0;
  } else {
    answers = {};
    view = hasMatchingConsent ? "age" : "welcome";
  }

  // Start from how the person is already known.
  if (!answers.preferredName && session.person.preferredName) answers.preferredName = session.person.preferredName;
  if (!answers.fullName && session.person.fullName) answers.fullName = session.person.fullName;
  // Someone who is already reached on a number (a leader, say) does not type it twice.
  if (!editing) {
    if (!answers.phone && contact.phone) answers.phone = contact.phone;
    if (answers.whatsappOk === undefined && contact.whatsapp) answers.whatsappOk = true;
    if (answers.smsOk === undefined && contact.sms) answers.smsOk = true;
  }

  return (
    <IntakeFlow
      personId={session.person.id}
      catalogue={catalogue}
      aiAvailable={aiAvailable}
      voiceAvailable={voiceAvailable}
      email={session.person.email ?? null}
      numberRequired={numberRequired}
      help={<HowToPilot data={pilotFor(session.roles, [])} variant="inline" />}
      seasonName={seasonName}
      seasonStarts={seasonStarts}
      seasonRunning={seasonRunning}
      initial={{ view, answers, activeSeconds, ai: aiConsent.data === true, isEdit: editing }}
    />
  );
}
