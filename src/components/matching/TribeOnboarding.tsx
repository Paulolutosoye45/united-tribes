"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markCalledAction, saveOnboardingAction } from "@/app/(app)/lead/tribe/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { whatsappLink } from "@/lib/leaders/status";
import { formatDate, plural } from "@/lib/dates";
import { GROUP_ROLES } from "@/lib/intake/options";
import type { Roster } from "@/lib/matching/types";
import { welcomeMessage } from "@/lib/matching/wording";
import { placementMark } from "@/lib/placement/marks";
import { LEADER_EMPTY } from "@/lib/placement/wording";

/** The leader's welcome work: who has joined, who they have called, the WhatsApp group and the first meeting. */
export function TribeOnboarding({ roster, leaderFirstName }: { roster: Roster; leaderFirstName: string }) {
  const router = useRouter();
  const { tribe, members } = roster;
  const editable = tribe.can_edit;
  const [group, setGroup] = useState(tribe.group_url ?? "");
  const [first, setFirst] = useState(tribe.first_meeting_on ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const called = members.filter((m) => m.called).length;

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await saveOnboardingAction(tribe.id, group, first);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setSaved(true);
    router.refresh();
  }

  async function toggle(personId: string, next: boolean) {
    setWorking(personId);
    setError(null);
    const result = await markCalledAction(tribe.id, personId, next);
    setWorking(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <section aria-labelledby="roster-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="roster-heading" className="t-heading">
          Your members
        </h2>
        <p className="t-body measure text-soft">
          {members.length === 0
            ? LEADER_EMPTY
            : `${plural(members.length, "member")} of ${tribe.capacity} seats. You have welcomed ${called} of ${members.length}.`}
        </p>
      </div>

      {members.length > 0 ? (
        <ul className="stagger flex flex-col gap-3">
          {members.map((m, i) => {
            const mark = placementMark(m, m.first_name);
            return (
            <li key={m.person_id} style={{ ["--i" as string]: Math.min(i, 8) }} className="card flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{m.name}</p>
                  <p className="t-small text-soft">Joined {formatDate(m.joined_at.slice(0, 10))}</p>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  {mark ? <Badge tone="neutral">{mark.label}</Badge> : null}
                  {m.called ? <Badge tone="gold">Welcomed</Badge> : <Badge tone="outline">To welcome</Badge>}
                </span>
              </div>
              <MemberBrief member={m} />
              <div className="flex flex-wrap items-center gap-2.5">
                {m.whatsapp ? (
                  <>
                    <a
                      href={whatsappLink(
                        m.whatsapp,
                        welcomeMessage({
                          memberFirst: m.first_name,
                          leaderFirst: leaderFirstName,
                          tribe: tribe.name,
                          when: tribe.first_meeting_on ? formatDate(tribe.first_meeting_on) : null,
                        }),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-solid inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-semibold"
                    >
                      Message on WhatsApp
                    </a>
                    <a href={`tel:${m.whatsapp}`} className="btn btn-quiet inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium">
                      Call
                    </a>
                  </>
                ) : (
                  <p className="t-small text-soft">
                    {m.withheld
                      ? `${m.first_name} asked that their number is not shared. They have your details and will reach out. You can message them in the tribe’s WhatsApp group.`
                      : mark?.note && (m.contact === "holding" || m.contact === "waiting" || m.contact === "not_reached")
                        ? mark.note
                        : `No WhatsApp number shared. Ask your coach how to reach ${m.first_name}.`}
                  </p>
                )}
                {editable ? (
                  <Button variant="ghost" size="sm" loading={working === m.person_id} aria-pressed={m.called} onClick={() => void toggle(m.person_id, !m.called)}>
                    {m.called ? "Mark as not yet welcomed" : "I have welcomed them"}
                  </Button>
                ) : null}
              </div>
            </li>
            );
          })}
        </ul>
      ) : null}

      {editable ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="card grid gap-5 p-5 sm:grid-cols-2 sm:p-7"
        >
          <div className="sm:col-span-2">
            <h3 className="font-semibold">For your tribe</h3>
            <p className="t-small text-soft">Members see these on their page as soon as you save.</p>
          </div>
          <Input
            label="WhatsApp group invite link"
            name="group_url"
            inputMode="url"
            autoComplete="off"
            optional
            value={group}
            placeholder="https://chat.whatsapp.com/…"
            hint="In WhatsApp, open the group, then Group info, then Invite via link."
            onChange={(e) => {
              setGroup(e.target.value);
              setSaved(false);
            }}
          />
          <Input
            label="First meeting"
            name="first_meeting"
            type="date"
            optional
            value={first}
            min={new Date().toISOString().slice(0, 10)}
            hint={`The season starts on ${formatDate(tribe.season_starts_on)}. Aim to meet within two weeks of it.`}
            onChange={(e) => {
              setFirst(e.target.value);
              setSaved(false);
            }}
          />
          {error ? (
            <p role="alert" className="t-small text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" size="md" loading={saving}>
              Save
            </Button>
            {saved ? (
              <p role="status" className="t-small text-soft">
                Saved.
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="t-small text-soft">
          WhatsApp group: {tribe.group_url ? "set" : "not set yet"}. First meeting: {tribe.first_meeting_on ? formatDate(tribe.first_meeting_on) : "not set yet"}.
        </p>
      )}
      {!editable && error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const ROLE_LABEL = new Map<string, string>(GROUP_ROLES.map((r) => [r.id, r.label]));

/**
 * What a member chose to tell their leader: the part they like to play in a group, the sentence they hope
 * to say in week 12, and, if they wrote one, a private note. The note is for the leader and assistant only;
 * the database does not hand it to anyone else.
 */
function MemberBrief({ member: m }: { member: Roster["members"][number] }) {
  const roles = m.roles.map((r) => ROLE_LABEL.get(r)).filter((r): r is string => Boolean(r));
  if (roles.length === 0 && !m.success && !m.note && !m.note_locked) return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="member-brief">
      {roles.length > 0 ? (
        <p className="t-small flex flex-wrap items-center gap-2">
          <span className="font-semibold">In a group, {m.first_name} is</span>
          {roles.map((r) => (
            <Badge key={r} tone="outline">
              {r}
            </Badge>
          ))}
        </p>
      ) : null}
      {m.success ? (
        <p className="t-small">
          <span className="font-semibold">By week 12, {m.first_name} hopes to say:</span> <q>{m.success}</q>
        </p>
      ) : null}
      {m.note ? (
        <p className="t-small" data-testid="leader-note">
          <span className="font-semibold">A note for you alone:</span> {m.note}
        </p>
      ) : m.note_locked ? (
        <p className="t-small text-soft">{m.first_name} left you a private note, but it can’t be opened right now. Please tell your coach.</p>
      ) : null}
    </div>
  );
}
