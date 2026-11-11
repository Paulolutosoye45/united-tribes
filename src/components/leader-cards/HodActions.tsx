"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteHodAction, inviteHodAction, tagHodAction } from "@/app/(app)/admin/people/leader-cards/reconcile/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { pluralise } from "@/lib/placement/wording";

type Props = {
  id: string;
  /** From the report as it reads now */
  tag: number;
  differs: number;
  invite: number;
  noEmail: number;
  /** Only an admin or a director may send invitations */
  canInvite: boolean;
  taggedAt: string | null;
  invitedAt: string | null;
  invitedN: number | null;
};

const when = (iso: string) => iso.slice(0, 10);

/** The three things the office can do from a report. Each is its own tap, says how many people it will touch first, and says what it did after. */
export function HodActions({ id, tag, differs, invite, noEmail, canInvite, taggedAt, invitedAt, invitedN }: Props) {
  const router = useRouter();
  const d = useDo();
  const [sure, setSure] = useState<"invite" | "delete" | null>(null);

  return (
    <section aria-labelledby="hod-do" className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="hod-actions">
      <h2 id="hod-do" className="t-heading">
        What you can do from this report
      </h2>

      <div className="flex flex-col gap-2">
        <p className="font-semibold">Put each leader’s department on their card</p>
        <p className="t-small text-soft">
          {tag === 0
            ? "No leader on the list is waiting for a department."
            : `${pluralise(tag, "leader")} already on the platform ${tag === 1 ? "has" : "have"} no department. This puts the one on your list.`}{" "}
          It is a label only, and it never changes a department that is already set
          {differs > 0 ? ` (${pluralise(differs, "leader")} already ${differs === 1 ? "has" : "have"} a different one, and will keep it)` : ""}.
          {taggedAt ? ` Done on ${when(taggedAt)}; you can run it again if the list has more.` : ""}
        </p>
        <div>
          <Button size="md" variant="quiet" loading={d.busy === "tag"} disabled={tag === 0 || !!d.busy} onClick={() => void d.go("tag", async () => {
            const r = await tagHodAction(id);
            return r.ok ? { ok: true as const } : r;
          }, { saved: "The departments are on their cards." })}>
            Put the departments on
          </Button>
        </div>
      </div>

      {canInvite ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Invite the people with no account</p>
          <p className="t-small text-soft">
            {invitedAt
              ? `Sent on ${when(invitedAt)} to ${pluralise(invitedN ?? 0, "person", "people")}. Each invitation can be sent once for a report.`
              : invite === 0
                ? "Nobody on the list who has an email address is without an account."
                : `${pluralise(invite, "person", "people")} with an email address and no account would get the leader invitation: the same email as when you invite someone in People.`}
            {!invitedAt && noEmail > 0 ? ` ${pluralise(noEmail, "person", "people")} with no usable email address cannot be invited from here.` : ""}
          </p>
          {invitedAt || invite === 0 ? null : sure === "invite" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="md" variant="solid" loading={d.busy === "invite"} disabled={!!d.busy} onClick={() => void d.go("invite", async () => {
                const r = await inviteHodAction(id);
                return r.ok ? { ok: true as const } : r;
              }, { saved: "The invitations are sent.", after: () => setSure(null) })}>
                Yes, send {pluralise(invite, "invitation")}
              </Button>
              <Button size="md" variant="ghost" disabled={!!d.busy} onClick={() => setSure(null)}>
                Not yet
              </Button>
            </div>
          ) : (
            <div>
              <Button size="md" variant="quiet" disabled={!!d.busy} onClick={() => setSure("invite")}>
                Invite them
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="font-semibold">Delete this report</p>
        <p className="t-small text-soft">This removes the report and the names, emails and numbers it holds. Nobody on the platform is changed.</p>
        {sure === "delete" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" variant="solid" loading={d.busy === "delete"} disabled={!!d.busy} onClick={() => void d.go("delete", () => deleteHodAction(id).then((r) => (r.ok ? { ok: true as const } : r)), { after: () => router.push("/admin/people/leader-cards/reconcile") })}>
              Yes, delete it
            </Button>
            <Button size="md" variant="ghost" disabled={!!d.busy} onClick={() => setSure(null)}>
              Keep it
            </Button>
          </div>
        ) : (
          <div>
            <Button size="md" variant="quiet" disabled={!!d.busy} onClick={() => setSure("delete")}>
              Delete the report
            </Button>
          </div>
        )}
      </div>
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
