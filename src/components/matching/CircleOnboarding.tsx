"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markCalledAction, saveOnboardingAction } from "@/app/(app)/lead/circle/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { whatsappLink } from "@/lib/leaders/status";
import { formatDate, plural } from "@/lib/dates";
import type { Roster } from "@/lib/matching/types";
import { welcomeMessage } from "@/lib/matching/wording";

/** The leader's welcome work: who has joined, who they have called, the WhatsApp group and the first meeting. */
export function CircleOnboarding({ roster, leaderFirstName }: { roster: Roster; leaderFirstName: string }) {
  const router = useRouter();
  const { circle, members } = roster;
  const editable = circle.can_edit;
  const [group, setGroup] = useState(circle.group_url ?? "");
  const [first, setFirst] = useState(circle.first_meeting_on ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const called = members.filter((m) => m.called).length;

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await saveOnboardingAction(circle.id, group, first);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setSaved(true);
    router.refresh();
  }

  async function toggle(personId: string, next: boolean) {
    setWorking(personId);
    setError(null);
    const result = await markCalledAction(circle.id, personId, next);
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
            ? "No one has joined yet. Members choose your Tribe from the three they are shown, and appear here the moment they join."
            : `${plural(members.length, "member")} of ${circle.capacity} seats. You have welcomed ${called} of ${members.length}.`}
        </p>
      </div>

      {members.length > 0 ? (
        <ul className="stagger flex flex-col gap-3">
          {members.map((m, i) => (
            <li key={m.person_id} style={{ ["--i" as string]: Math.min(i, 8) }} className="card flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{m.name}</p>
                  <p className="t-small text-soft">Joined {formatDate(m.joined_at.slice(0, 10))}</p>
                </div>
                {m.called ? <Badge tone="gold">Welcomed</Badge> : <Badge tone="outline">To welcome</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {m.whatsapp ? (
                  <>
                    <a
                      href={whatsappLink(
                        m.whatsapp,
                        welcomeMessage({
                          memberFirst: m.first_name,
                          leaderFirst: leaderFirstName,
                          circle: circle.name,
                          when: circle.first_meeting_on ? formatDate(circle.first_meeting_on) : null,
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
                  <p className="t-small text-soft">No WhatsApp number shared. Ask your coach how to reach {m.first_name}.</p>
                )}
                {editable ? (
                  <Button variant="ghost" size="sm" loading={working === m.person_id} aria-pressed={m.called} onClick={() => void toggle(m.person_id, !m.called)}>
                    {m.called ? "Mark as not yet welcomed" : "I have welcomed them"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
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
            <h3 className="font-semibold">For your Tribe</h3>
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
            hint={`The season starts on ${formatDate(circle.season_starts_on)}. Aim to meet within two weeks of it.`}
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
          WhatsApp group: {circle.group_url ? "set" : "not set yet"}. First meeting: {circle.first_meeting_on ? formatDate(circle.first_meeting_on) : "not set yet"}.
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
