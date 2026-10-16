import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DataTable, Section, Tile, Unavailable } from "@/components/activity/parts";
import { longDay, num, show } from "@/lib/activity/format";
import { loadIntegrity, markViewed } from "@/lib/activity/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quality and integrity" };

const words = (key: string) => key.replace(/_/g, " ");
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export default async function QualityPage() {
  await connection();
  const supabase = await createClient();
  const d = await loadIntegrity(supabase);
  if (!d) return <Unavailable />;
  await markViewed(supabase, "integrity");

  const flags = Object.entries(d.referee_flags);
  const states = Object.entries(d.ai_states);
  const declined = Object.entries(d.signins.declined_7d);

  return (
    <div className="flex flex-col gap-10">
      <p className="t-body measure text-soft">
        Signs that someone may be gaming the system, and whether the checks themselves are working. These are prompts to look, not verdicts: each one links to the page where a person can look at the case.
      </p>

      <Section id="cases" title="Cases to look at" intro="Open referee flags, overdue call-backs, held applications and referees changed three times or more, oldest first.">
        {d.cases.length === 0 ? (
          <p className="card t-body p-5 text-soft">Nothing is waiting to be looked at.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Cases">
            {d.cases.map((c, i) => (
              <li key={`${c.kind}-${c.ref}-${i}`} data-case={c.kind}>
                <Link href={c.href} className="card press flex flex-wrap items-baseline justify-between gap-2 p-4">
                  <span className="font-medium">{c.label}</span>
                  <span className="t-small text-soft">
                    ref {c.ref} · since {longDay(c.at.slice(0, 10))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="answers" title="Are the answer checks working?" intro="The leader application checks each written answer as it is typed. Last 30 days.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Answers checked" value={num(d.answer_checks.checked)} />
          <Tile label="Did not pass" value={num(d.answer_checks.failed)} />
          <Tile label="Sent anyway" value={num(d.answer_checks.forced_through)} note="after the check said no" />
          <Tile label="Read by the AI" value={num(d.answer_checks.ai_checked)} />
        </div>
        {d.failing_fields.length > 0 ? (
          <DataTable caption="Answers that most often did not pass" head={["Answer", "Did not pass"]} rows={d.failing_fields.map((f) => [cap(words(f.field)), num(f.n)])} />
        ) : null}
      </Section>

      <Section id="ai" title="Do the AI and the people agree?" intro="For applications the AI cleared, a sample is also read by people. A large gap means the AI scores too kindly or too strictly.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Applications compared" value={num(d.ai_vs_people.pairs)} />
          <Tile label="Average gap" value={d.ai_vs_people.mean_gap === null ? "not enough yet" : `${num(d.ai_vs_people.mean_gap)} points`} />
          <Tile label="AI kinder than people" value={num(d.ai_vs_people.ai_kinder)} note="by more than 10 points" />
          <Tile label="AI stricter than people" value={num(d.ai_vs_people.ai_stricter)} note="by more than 10 points" />
        </div>
        {states.length > 0 ? (
          <DataTable caption="Where recent applications stand" head={["Where it stands", "Applications (90 days)"]} rows={states.map(([k, v]) => [cap(words(k)), show(v)])} />
        ) : null}
      </Section>

      <Section id="referees" title="Referees" intro="Flags raised on references, call-backs, and referees changed after the applicant was asked about them.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Call-backs open" value={num(d.callbacks.open)} note={`${num(d.callbacks.overdue)} overdue`} />
          <Tile label="Referee changes" value={num(d.changes.referee_changes_30d)} note={`${num(d.changes.after_a_request_30d)} after a request · 30 days`} />
          <Tile label="Changed three times or more" value={num(d.changes.changed_three_times_or_more)} />
          <Tile label="Call-backs closed" value={num(d.callbacks.confirmed + d.callbacks.not_reached + d.callbacks.not_them)} note={`${num(d.callbacks.confirmed)} confirmed · ${num(d.callbacks.not_them)} not them · 30 days`} />
        </div>
        {flags.length > 0 ? (
          <DataTable caption="Referee flags" head={["Kind of flag", "Open now", "Raised in 30 days"]} rows={flags.map(([k, v]) => [cap(words(k)), num(v.open), num(v.last_30d)])} />
        ) : null}
      </Section>

      <Section id="answers-changed" title="Answers changed after sending" intro="Counted only from the day the answer-change log is switched on in the form. Until then these read zero.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Answers changed (30 days)" value={num(d.changes.answer_changes_30d)} />
          <Tile label="People who changed three or more" value={show(d.changes.repeat_answer_changers)} />
        </div>
      </Section>

      <Section id="signins" title="Sign-in abuse signals" intro="Codes the system refused to send, and numbers that kept asking. Last 7 days unless it says otherwise.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Codes failed or rejected" value={num(d.signins.failed_or_rejected_7d)} />
          <Tile label="Numbers that hit the limit" value={num(d.signins.numbers_hit_the_limit_24h)} note="in the last 24 hours" />
        </div>
        {declined.length > 0 ? (
          <DataTable caption="Codes the system declined to send" head={["Why", "Times"]} rows={declined.map(([k, v]) => [cap(words(k.replace(/^declined_/, ""))), num(v)])} />
        ) : null}
        <p className="t-small text-soft">
          The breaker and the limits are set on the{" "}
          <Link href="/admin/signin" className="underline">
            sign-in screen
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
