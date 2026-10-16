import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DataTable, Section, Tile, Unavailable } from "@/components/activity/parts";
import { num, pctText, secondsText, shortDay } from "@/lib/activity/format";
import { loadMessages, markViewed } from "@/lib/activity/server";
import { ago, clock } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Messages and sign-in" };

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const METHODS: Record<string, string> = { email: "Email code", whatsapp: "WhatsApp code", google: "Google", link: "Email link", unknown: "Not recorded" };

export default async function MessagesPage() {
  await connection();
  const supabase = await createClient();
  const d = await loadMessages(supabase);
  if (!d) return <Unavailable />;
  await markViewed(supabase, "messages");
  const now = clock();

  const delivered = d.channels.reduce((a, c) => a + c.sent + c.delivered + c.read, 0);
  const attempted = delivered + d.channels.reduce((a, c) => a + c.failed, 0);
  const days = d.code_days;
  const topDay = Math.max(1, ...days.map((x) => x.asked));
  const methods = Object.entries(d.signins_by_method).sort((a, b) => b[1] - a[1]);
  const b = d.breaker;

  return (
    <div className="flex flex-col gap-10">
      <p className="t-body measure text-soft">
        Whether messages and sign-in codes are reaching people, and whether the way someone signs in is the reason they stop. Last 30 days unless it says otherwise.
      </p>

      <Section id="messages" title="Messages">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Reached people" value={pctText(attempted >= 20 ? Math.round((delivered / attempted) * 1000) / 10 : null, "not enough yet")} note={`${num(delivered)} of ${num(attempted)} sent or failed`} />
          <Tile label="Failed" value={num(d.channels.reduce((a, c) => a + c.failed, 0))} href="/admin/messages" note="open Messages" />
          <Tile label="Waiting to go" value={num(d.channels.reduce((a, c) => a + c.queued, 0))} />
          <Tile label="Opted out" value={num(d.opt_outs.opted_out_30d)} note={`${num(d.opt_outs.stop_or_not_me_30d)} replied STOP or “not me”`} />
        </div>
        <DataTable
          caption="Messages by channel"
          head={["Channel", "Waiting", "Sent", "Delivered", "Read", "Failed", "Skipped", "Total"]}
          rows={d.channels.map((c) => [cap(c.channel), num(c.queued), num(c.sent), num(c.delivered), num(c.read), num(c.failed), num(c.skipped), num(c.total)])}
          empty="No messages in the last 30 days."
        />
      </Section>

      <Section id="codes" title="Sign-in codes" intro="Codes people asked for on the sign-in screen.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Asked for" value={num(d.codes.asked)} />
          <Tile label="Sent" value={num(d.codes.sent)} />
          <Tile label="Failed" value={num(d.codes.failed)} note={`${num(d.codes.declined)} declined · ${num(d.codes.unmatched)} no account`} />
          <Tile label="Time to send" value={d.codes.median_send_seconds === null ? "not enough yet" : secondsText(d.codes.median_send_seconds)} note="the middle one" />
        </div>
        <div className="card flex flex-col gap-3 p-5 sm:p-6">
          <h3 className="t-heading">The last 14 days</h3>
          <ul className="flex flex-col gap-1.5" aria-label="Codes by day">
            {days.map((x) => (
              <li key={x.day} className="grid grid-cols-[4rem_1fr_9rem] items-center gap-3">
                <span className="t-small text-soft">{shortDay(x.day)}</span>
                <span className="flex h-3 overflow-hidden rounded-full bg-surface-strong" aria-hidden="true">
                  <span className="block h-3 bg-flame" style={{ width: `${((x.sent) / topDay) * 100}%` }} />
                  <span className="block h-3 bg-ink" style={{ width: `${((x.failed) / topDay) * 100}%` }} />
                </span>
                <span className="t-small text-right text-soft [font-variant-numeric:tabular-nums]">
                  {num(x.sent)} sent{x.failed > 0 ? ` · ${num(x.failed)} failed` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="how" title="How people sign in" intro="Counted from the day sign-in recording began; earlier sign-ins are not in the log.">
        <DataTable
          caption="Sign-ins by method"
          head={["Method", "Sign-ins (30 days)"]}
          rows={methods.map(([k, v]) => [METHODS[k] ?? cap(k), num(v)])}
          empty="No sign-ins recorded yet."
        />
      </Section>

      <Section id="breaker" title="WhatsApp and the breaker" intro="The same state as the sign-in screen. Change it there, not here.">
        {b ? (
          <div className="card flex flex-col gap-2 p-5 sm:p-6" data-breaker={b.state}>
            <p className="t-body">
              WhatsApp codes are <strong>{b.whatsapp_on ? "on" : "off"}</strong>, mode <strong>{b.mode}</strong>. The breaker is <strong>{b.state}</strong>
              {b.reason ? ` (${b.reason})` : ""}.
            </p>
            <p className="t-small text-soft">
              {b.tripped_at ? `Last tripped ${ago(b.tripped_at, now) || b.tripped_at.slice(0, 10)}. ` : "Never tripped. "}
              {num(b.trips_30d)} {b.trips_30d === 1 ? "trip" : "trips"} in 30 days.{b.sender_signal ? ` The sending number says: ${b.sender_signal}.` : ""}
            </p>
            <p>
              <Link href="/admin/signin" className="t-body underline">
                Open the sign-in screen
              </Link>
            </p>
          </div>
        ) : (
          <p className="card t-body p-5 text-soft">The sign-in settings are not set up.</p>
        )}
        {Object.keys(d.opt_outs.email_signals_30d).length > 0 ? (
          <DataTable
            caption="Email signals"
            head={["What the email service said", "Times (30 days)"]}
            rows={Object.entries(d.opt_outs.email_signals_30d).map(([k, v]) => [cap(k.replace(/_/g, " ")), num(v)])}
          />
        ) : null}
      </Section>
    </div>
  );
}
