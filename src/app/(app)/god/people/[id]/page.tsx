import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PersonPlace } from "@/components/placement/PersonPlace";
import { RoleManager } from "@/components/god/RoleManager";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import { parseRoles } from "@/lib/auth/roles";
import { loadPerson } from "@/lib/god/server";
import { ago, clock, describeAction } from "@/lib/god/wording";
import { isUuid } from "@/lib/leaders/errors";
import { loadOneOptions, loadPlacementOverview } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A person" };

type Params = Promise<{ id: string }>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="t-heading">{title}</h2>
      <div className="card flex flex-col gap-2 p-5">{children}</div>
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <p className="t-body flex flex-wrap justify-between gap-x-4">
    <span className="text-soft">{k}</span>
    <span className="text-right">{v}</span>
  </p>
);

export default async function GodPersonPage({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const p = await loadPerson(supabase, id);
  if (!p) notFound();
  // Placing one person, or moving one who holds a seat: only for a member who does not lead. The database checks it all again.
  const roleList = parseRoles(p.roles);
  const canPlace = p.leads.length === 0 && !roleList.some((r) => r === "leader" || r === "assistant_leader");
  const [placeOptions, overview] = canPlace ? await Promise.all([loadOneOptions(supabase, id), loadPlacementOverview(supabase)]) : [[], null];
  const now = clock();
  const name = p.person.full_name ?? p.person.preferred_name ?? p.person.email;
  const mode = (m: string | null) => (m ? m.replace(/_/g, " ") : "—");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/god/people" className="t-small text-soft hover:text-ink">
          <span aria-hidden="true">← </span>People
        </Link>
        <div className="flex items-center gap-4">
          <Avatar name={name} size={56} photoId={p.person.id} />
          <div className="min-w-0">
            <h1 className="t-title truncate">{name}</h1>
            <p className="t-small text-soft">
              {p.person.email} · joined {formatShortDate(p.person.created_at)}
              {p.person.centre ? ` · ${p.person.centre}` : ""}
            </p>
          </div>
        </div>
      </header>

      <Section title="Roles">
        <RoleManager person={p.person.id} email={p.person.email} roles={parseRoles(p.roles)} />
      </Section>

      {canPlace ? <PersonPlace person={p.person.id} name={name} options={placeOptions} mode={overview?.settings.mode ?? null} role="owner" hasSeat={Boolean(p.placement)} ownerLink /> : null}

      <Section title="Where they are">
        {p.form ? (
          <>
            <Row k="Form" v={<Badge>Done</Badge>} />
            <Row k="Community" v={p.form.community ?? "—"} />
            <Row k="Season goal" v={p.form.goal ?? "—"} />
            <Row k="Age and track" v={`${p.form.age ?? "—"}${p.form.track ? ` · ${p.form.track}` : ""}`} />
            <Row k="Area and way of meeting" v={`${p.form.zone ?? "—"} · ${mode(p.form.mode)}`} />
            {p.form.seconds ? <Row k="Time it took" v={`${Math.round(p.form.seconds / 60)} min`} /> : null}
          </>
        ) : p.draft ? (
          <Row k="Form" v={`Started, at “${(p.draft.step ?? "the beginning").replace(/_/g, " ")}”, ${ago(p.draft.updated_at, now) || formatShortDate(p.draft.updated_at)}`} />
        ) : (
          <Row k="Form" v="Not started" />
        )}
        {p.placement ? (
          <Row
            k="Tribe"
            v={
              <Link href={`/god/tribes/${p.placement.tribe_id}`} className="underline">
                {p.placement.tribe}
              </Link>
            }
          />
        ) : null}
        {p.placement?.leader ? <Row k="Leader" v={p.placement.leader} /> : null}
        {p.attendance.present + p.attendance.absent + p.attendance.excused > 0 ? (
          <Row k="Attendance" v={`${p.attendance.present} present · ${p.attendance.absent} absent · ${p.attendance.excused} excused`} />
        ) : null}
        {p.application ? <Row k="Leader application" v={p.application.status.replace(/_/g, " ")} /> : null}
        {p.erasure ? <Row k="Deletion request" v={p.erasure === "open" ? "Asked to be deleted" : "Answered: not yet"} /> : null}
      </Section>

      {p.leads.length > 0 ? (
        <Section title="Tribes they lead or support">
          {p.leads.map((c) => (
            <Row
              key={c.id}
              k={c.status.replace(/_/g, " ")}
              v={
                <Link href={`/god/tribes/${c.id}`} className="underline">
                  {c.name} · {c.members} {c.members === 1 ? "member" : "members"}
                </Link>
              }
            />
          ))}
        </Section>
      ) : null}

      <Section title="Agreements">
        {p.consents.length === 0 ? (
          <p className="t-body text-soft">None given yet.</p>
        ) : (
          p.consents.map((c) => <Row key={c.purpose} k={c.purpose.replace(/_/g, " ")} v={`${c.granted ? "Agreed" : "Withdrawn"} · ${formatShortDate(c.at)}`} />)
        )}
      </Section>

      <Section title="Messages and the assistant">
        {Object.keys(p.messages.by_status).length === 0 ? (
          <Row k="Messages" v="None sent" />
        ) : (
          <Row k="Messages" v={Object.entries(p.messages.by_status).map(([s, n]) => `${n} ${s}`).join(" · ")} />
        )}
        {p.messages.recent.map((m, i) => (
          <p key={i} className="t-small text-soft">
            {m.template.replace(/_/g, " ")} · {m.channel ?? "no channel yet"} · {m.status} · {ago(m.at, now) || formatShortDate(m.at)}
          </p>
        ))}
        <Row k="Assistant" v={`${p.assistant.calls} calls · ${p.assistant.fallbacks} fell back`} />
        <p className="t-small">
          <Link href={`/god/conversations?person=${p.person.id}`} className="underline">
            Read every message sent to them, and their answers
          </Link>
        </p>
      </Section>

      <Section title="Recent activity">
        {p.events.length === 0 ? (
          <p className="t-body text-soft">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {p.events.map((e) => (
              <li key={e.id} className="t-body flex flex-wrap justify-between gap-x-4">
                <span>{e.by_them ? describeAction(e.action) : `Someone else: ${describeAction(e.action)}`}</span>
                <span className="t-small text-soft">
                  {ago(e.at, now) || `${formatLagosDay(e.at)}, ${formatLagosTime(e.at)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="t-small measure text-soft">
        Their private notes (what would help us care for them, and the note for their leader) stay sealed here, as everywhere. Only the member opens them.
      </p>
    </div>
  );
}
