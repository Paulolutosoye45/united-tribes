import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHead } from "@/components/admin/PageHead";
import { OfficeRequests } from "@/components/placement/OfficeRequests";
import { PersonPlace } from "@/components/placement/PersonPlace";
import { PlacedLately } from "@/components/placement/PlacedLately";
import { PersonRemove, RemovedLately } from "@/components/placement/RemoveMember";
import { Badge } from "@/components/ui/Badge";
import { PLACE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatShortDate } from "@/lib/dates";
import { isUuid } from "@/lib/leaders/errors";
import { loadOfficePerson, loadOneOptions, loadPersonRemoval, loadRequests } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A member" };

type Params = Promise<{ id: string }>;

const HOLD_WORDS: Record<string, string> = {
  removal: "The church took them out of a tribe a short while ago, so automatic placement leaves them alone for now.",
  care: "The Care Team is looking after this person, so automatic placement leaves them alone.",
  owner: "The owner put this person on hold, so automatic placement leaves them alone.",
};

export default async function PersonPage({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  const session = await requireRole(PLACE_ROLES, "/admin/people");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const info = await loadOfficePerson(supabase, id);
  if (!info) notFound();
  const canPlace = info.member && !info.leads;
  const [options, requests, removal] = await Promise.all([
    canPlace ? loadOneOptions(supabase, id) : Promise.resolve([]),
    loadRequests(supabase, id),
    info.member ? loadPersonRemoval(supabase, id) : Promise.resolve(null),
  ]);
  const name = info.person.name;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Link href="/admin/people" className="t-small text-soft hover:text-ink">
          <span aria-hidden="true">← </span>People and roles
        </Link>
        <PageHead title={name}>{info.person.email}</PageHead>
      </div>

      <section aria-label="Where they are" className="flex flex-col gap-3">
        <h2 className="t-heading">Where they are</h2>
        <div className="card flex flex-col gap-2 p-5">
          <p className="t-body flex flex-wrap justify-between gap-x-4">
            <span className="text-soft">Tribe</span>
            <span className="text-right" data-testid="person-seat">
              {info.seat ? (
                <Link href={`/admin/tribes/${info.seat.tribe}`} className="underline underline-offset-4">
                  {info.seat.name}
                </Link>
              ) : (
                "No tribe yet"
              )}
            </span>
          </p>
          {info.seat ? (
            <p className="t-body flex flex-wrap justify-between gap-x-4">
              <span className="text-soft">Leader</span>
              <span>{info.seat.leader}</span>
            </p>
          ) : null}
          <p className="t-body flex flex-wrap justify-between gap-x-4">
            <span className="text-soft">Find my tribe</span>
            <span>{info.form ? <Badge>Done</Badge> : "Not finished"}</span>
          </p>
          {info.hold ? <p className="t-small rounded-[var(--radius-control)] bg-gold/20 p-3">{HOLD_WORDS[info.hold.source] ?? "Automatic placement leaves them alone for now."}{info.hold.until ? ` Until ${formatShortDate(info.hold.until)}.` : ""}</p> : null}
        </div>
      </section>

      {canPlace ? (
        <PersonPlace person={id} name={name} options={options} mode={info.mode} role={info.role} hasSeat={info.seat !== null} ownerLink={session.god === "open"} />
      ) : (
        <p className="card t-body p-5 text-soft" data-testid="person-cannot-place">
          {info.leads ? `${name} leads or supports a tribe, so they cannot be placed in one as a member.` : `${name} is not a member who can join a tribe.`}
        </p>
      )}

      {removal && info.member && !info.leads ? (
        <section aria-label="Remove from a tribe" className="flex flex-col gap-3">
          <h2 className="t-heading">Remove from a tribe</h2>
          <div className="card p-5">
            <PersonRemove person={{ id, name }} seat={removal.seat} />
          </div>
          {removal.lately.length > 0 ? (
            <div className="card p-5">
              <RemovedLately items={removal.lately} showName={false} empty="" />
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Last placement" className="flex flex-col gap-3">
        <h2 className="t-heading">Last placement from Admin</h2>
        <div className="card p-5">
          <PlacedLately items={info.last ? [info.last] : []} person={id} empty="Nobody has placed or moved them from here." />
        </div>
      </section>

      <section aria-label="Requests to the owner" className="flex flex-col gap-3">
        <h2 className="t-heading">Requests to the owner</h2>
        <OfficeRequests requests={requests} owner={false} person={id} />
      </section>
    </div>
  );
}
