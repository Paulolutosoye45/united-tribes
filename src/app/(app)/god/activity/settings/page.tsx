import type { Metadata } from "next";
import { connection } from "next/server";
import { DataTable, Section, Unavailable } from "@/components/activity/parts";
import { RecordingForm, RetentionForm, ThresholdForm } from "@/components/activity/SettingsForms";
import { loadSettings, markViewed } from "@/lib/activity/server";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity settings" };

const AREAS: Record<string, string> = { "sign-in": "Signing in", screen: "Screens", form: "Forms", directory: "The directory" };

export default async function SettingsPage() {
  await connection();
  const supabase = await createClient();
  const s = await loadSettings(supabase);
  if (!s) return <Unavailable />;
  await markViewed(supabase, "settings");

  return (
    <div className="flex flex-col gap-10">
      <Section id="recording" title="Recording" intro="Switching it off stops anything new being counted. The owner and hidden accounts are never recorded either way.">
        <div className="card p-5 sm:p-6">
          <RecordingForm recording={s.recording} />
        </div>
        <div className="card p-5 sm:p-6">
          <RetentionForm months={s.retention_months} />
        </div>
        <p className="t-small text-soft">
          {s.last_refresh ? `Summaries last built ${formatShortDate(s.last_refresh)}.` : "Summaries have not been built yet."}{" "}
          {s.last_backfill ? `Filled back from the start on ${formatShortDate(s.last_backfill)}.` : ""}
        </p>
      </Section>

      <Section id="flags" title="When something needs a decision" intro="Each flag appears on the Pulse tab, and in the weekly brief, only when its number passes the one you set here. Every change is written in your record.">
        <div className="card divide-y divide-line px-5 sm:px-6">
          {s.thresholds.map((t) => (
            <ThresholdForm key={t.key} item={t} />
          ))}
        </div>
      </Section>

      <Section id="catalogue" title="Exactly what is recorded" intro="This is the whole list. An event not on it cannot be written, and the fields below are all an event can carry: short identifiers and numbers, never wording.">
        <DataTable
          caption="Kinds of event"
          head={["Event", "Where", "Carries", "Kept"]}
          rows={s.catalogue.map((c) => [
            <span key="l">
              {c.label}
              {c.reserved ? <span className="t-small block text-soft">Not recording yet: reserved for a later phase.</span> : null}
            </span>,
            AREAS[c.area] ?? c.area,
            c.fields.length > 0 ? c.fields.join(", ") : "nothing else",
            `${c.keep_months} months`,
          ])}
        />
      </Section>

      <Section id="rules" title="Rules that cannot be changed here">
        <ul className="card t-body flex list-disc flex-col gap-2 p-5 pl-9 sm:p-6 sm:pl-10">
          <li>It records what happened, when, and who, never what anyone wrote, said or answered.</li>
          <li>A group of fewer than {s.min_group} people is shown as “&lt;{s.min_group}”, never as a number.</li>
          <li>Young members are counted in totals but never named, listed or filtered on.</li>
          <li>Only you can open this. No menu, link or number about it appears for anyone else.</li>
          <li>Opening a tab, downloading the audit trail and changing a setting here are written in your own record.</li>
        </ul>
      </Section>
    </div>
  );
}
