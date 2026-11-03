import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { InviteForm } from "@/components/admin/InviteForm";
import { PeopleList, type PersonRow } from "@/components/admin/PeopleList";
import { FindMember } from "@/components/placement/FindMember";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { daysUntil, formatShortDate } from "@/lib/dates";
import { ROLE_LABELS, grantableRoles, parseRoles, type Role } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { revokeInvitationAction } from "../actions";

export const metadata: Metadata = { title: "People and roles" };

const PEOPLE_LIMIT = 200;

export default async function PeoplePage() {
  const session = await requireRole(["admin", "director"], "/admin/people");
  const supabase = await createClient();
  const grantable = grantableRoles(session.roles);

  const [invitations, people, roleRows] = await Promise.all([
    supabase
      .from("invitations")
      .select("id, email, role, created_at, expires_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("people")
      .select("id, email, full_name, preferred_name, created_at")
      .order("created_at", { ascending: false })
      .limit(PEOPLE_LIMIT),
    supabase.from("person_roles").select("person_id, role"),
  ]);

  const rolesByPerson = new Map<string, Role[]>();
  for (const row of roleRows.data ?? []) {
    const list = rolesByPerson.get(row.person_id) ?? [];
    list.push(...parseRoles([row.role]));
    rolesByPerson.set(row.person_id, list);
  }

  const pending = invitations.data ?? [];
  const rows: PersonRow[] = (people.data ?? []).map((p) => {
    const roles = rolesByPerson.get(p.id) ?? [];
    const named = p.full_name ?? p.preferred_name;
    return {
      id: p.id,
      name: named ?? p.email,
      email: p.email,
      hasName: Boolean(named),
      roles,
      removable: roles.filter((r) => grantable.includes(r)),
    };
  });

  return (
    <div className="flex flex-col gap-12">
      <PageHead title="People and roles">Invite the people who will run United Tribes and see who holds each role. Everyone who signs in is a member automatically.</PageHead>

      <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
        <h2 id="invite-heading" className="t-heading">
          Invite someone
        </h2>
        <div className="card p-5 sm:p-7">
          <InviteForm roles={grantable} />
        </div>
      </section>

      <section aria-labelledby="find-heading" className="flex flex-col gap-4">
        <h2 id="find-heading" className="t-heading">
          Find a member to place or move
        </h2>
        <p className="t-body measure text-soft">Search every member by name, e-mail or phone number, then open their page to put them in a tribe or move them to another.</p>
        <div className="card p-5 sm:p-7">
          <FindMember hrefBase="/admin/people" />
        </div>
      </section>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h2 id="pending-heading" className="t-heading">
          Waiting to sign in
        </h2>
        {pending.length === 0 ? (
          <p className="card t-body p-6 text-soft">No pending invitations. Invite someone above and they will appear here.</p>
        ) : (
          <ul className="stagger flex flex-col gap-3">
            {pending.map((inv, i) => {
              const role = parseRoles([inv.role])[0];
              const canRevoke = grantable.includes(role);
              const left = daysUntil(inv.expires_at.slice(0, 10));
              return (
                <li key={inv.id} style={{ ["--i" as string]: i }} className="card flex items-center justify-between gap-4 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{inv.email}</p>
                    <p className="t-small mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-soft">
                      <Badge tone="gold">{ROLE_LABELS[role]}</Badge>
                      <span>Invited {formatShortDate(inv.created_at)}</span>
                      <span>{left > 0 ? `${left} ${left === 1 ? "day" : "days"} left` : "Expires today"}</span>
                    </p>
                  </div>
                  {canRevoke ? (
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="id" value={inv.id} />
                      <Button type="submit" variant="quiet" size="md">
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="people-heading" className="flex flex-col gap-4">
        <h2 id="people-heading" className="t-heading">
          People
        </h2>
        <PeopleList people={rows} limit={PEOPLE_LIMIT} />
      </section>
    </div>
  );
}
