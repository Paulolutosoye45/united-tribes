import type { Metadata } from "next";
import { CareTaskList } from "@/components/care/CareTaskList";
import { hasAnyRole } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { plural } from "@/lib/dates";
import { loadCareStats, loadMyCareTasks } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Care tasks" };

export default async function CarePage() {
  const session = await requireSession("/care");
  const supabase = await createClient();
  const team = hasAnyRole(session.roles, ["care_lead", "pastor", "director"]);
  const [tasks, stats] = await Promise.all([
    loadMyCareTasks(supabase),
    hasAnyRole(session.roles, ["care_lead", "pastor", "director", "admin", "data_lead"]) ? loadCareStats(supabase) : Promise.resolve(null),
  ]);
  const raisedOpen = tasks.raised.filter((t) => t.status === "open");

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Care tasks</h1>
        <p className="t-body measure text-soft">
          When a leader flags someone, the right person gets a task and a deadline. Practical needs go to the assistant leader, pastoral ones to the coach, and urgent ones to the Care Lead the same day.
        </p>
      </header>

      {stats ? (
        <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="How care is going in the last 90 days">
          {[
            { label: "Open now", value: `${stats.open}`, note: `${stats.overdue} late` },
            { label: "Seen to in 7 days", value: stats.resolved > 0 ? `${Math.round((stats.resolved_in_7_days / stats.resolved) * 100)}%` : "–", note: `${plural(stats.resolved, "task")} done` },
            { label: "Urgent, same day", value: stats.urgent > 0 ? `${stats.urgent_same_day} of ${stats.urgent}` : "–", note: "answered the day it was raised" },
            { label: "Median to resolve", value: stats.median_days_to_resolve === null ? "–" : `${stats.median_days_to_resolve}`, note: stats.median_days_to_resolve === null ? "nothing done yet" : "days" },
          ].map((t, i) => (
            <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
              <dt className="t-small text-soft">{t.label}</dt>
              <dd className="t-figure !text-[clamp(1.6rem,7vw,2.4rem)]">{t.value}</dd>
              <dd className="t-small text-soft">{t.note}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section aria-labelledby="mine-heading" className="flex flex-col gap-4">
        <h2 id="mine-heading" className="t-heading">
          Waiting for you
        </h2>
        <CareTaskList tasks={tasks.mine} canAct canPass={team} emptyText="Nothing is waiting for you. Thank you for staying close to your tribe." />
      </section>

      {team ? (
        <section aria-labelledby="queue-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="queue-heading" className="t-heading">
              Care Lead queue
            </h2>
            <p className="t-small text-soft">Tasks nobody has been given yet. Urgent ones come first and should be answered today.</p>
          </div>
          <CareTaskList tasks={tasks.queue} canAct canPass emptyText="The queue is empty." />
        </section>
      ) : null}

      {team && tasks.others.length > 0 ? (
        <section aria-labelledby="others-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="others-heading" className="t-heading">
              With coaches and assistants
            </h2>
            <p className="t-small text-soft">Open tasks that someone else is looking after, soonest deadline first. Late ones can be passed on.</p>
          </div>
          <CareTaskList tasks={tasks.others} canAct canPass emptyText="" />
        </section>
      ) : null}

      {raisedOpen.length > 0 ? (
        <section aria-labelledby="raised-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="raised-heading" className="t-heading">
              What you flagged
            </h2>
            <p className="t-small text-soft">Needs you raised in the last 30 days that are still open.</p>
          </div>
          <CareTaskList tasks={raisedOpen} canAct={false} canPass={false} readOnly emptyText="" />
        </section>
      ) : null}
    </div>
  );
}
