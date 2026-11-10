"use client";

import { useState } from "react";
import { archiveGroupAction, removeMemberAction, suggestMembersAction, addMemberAction } from "@/app/(app)/god/leader-desk/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { DeskGroupForm } from "@/components/god/DeskGroupForm";
import { DeskCheckInterest } from "@/components/god/DeskCheckInterest";
import { DeskLeaderPanel } from "@/components/god/DeskLeaderPanel";
import { DeskReveal } from "@/components/god/DeskReveal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DeskChoices } from "@/lib/god/desk-server";
import { DESK_WORDS as W, describeGroup, slotWord, type Group, type Suggestion } from "@/lib/god/desk";
import { EMPTY_LEADER, type GroupLeader } from "@/lib/god/desk-offers";
import { EMPTY_INTEREST, INTEREST_WORDS, type InterestView } from "@/lib/god/desk-send";

const MARK: Record<string, string> = { ok: "✓", fix: "!", wait: "…" };

/** One draft group: who is in it and how well each suits it, the checks the matching itself would make, and the waiting members who would suit it best. */
export function DeskGroupCard({
  group,
  choices,
  minTribe,
  interest = EMPTY_INTEREST,
  leader = EMPTY_LEADER,
  rehearsal = true,
}: {
  group: Group;
  choices: DeskChoices;
  minTribe: number;
  interest?: InterestView;
  leader?: GroupLeader;
  rehearsal?: boolean;
}) {
  const d = useDo();
  const [editing, setEditing] = useState(false);
  const [suggested, setSuggested] = useState<Suggestion[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [sure, setSure] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function suggest() {
    if (asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const r = await suggestMembersAction(group.id);
      if (r.ok) setSuggested(r.people);
      else setAskError(r.message);
    } catch {
      setAskError("We couldn’t look that up. Try again.");
    }
    setAsking(false);
  }

  return (
    <li className="card flex flex-col gap-4 p-5" data-testid="desk-group">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="t-heading">{group.name}</h3>
          <p className="t-small text-soft">
            {group.track ? `${group.track}. ` : ""}
            {describeGroup(group)}
            {group.community ? `. ${group.community}` : ""}
            {group.goal ? `: ${group.goal}` : ""}
          </p>
          {group.note ? <p className="t-small text-soft">{group.note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={group.ready ? "flame" : "outline"}>{group.ready ? "Ready to form" : "Still building"}</Badge>
          <Badge tone="neutral">
            {group.size} of {group.capacity}
          </Badge>
          {group.average !== null && group.size > 0 ? <Badge tone="neutral">Average score {group.average}</Badge> : null}
        </div>
      </div>

      <ul className="flex flex-col gap-1" aria-label="Checks">
        {group.checks.map((c) => (
          <li key={c.code} className="t-small flex items-start gap-2" data-state={c.state}>
            <span aria-hidden className={c.state === "ok" ? "text-ink" : c.state === "fix" ? "font-semibold text-danger" : "text-soft"}>
              {MARK[c.state] ?? "…"}
            </span>
            <span>
              <span className="sr-only">{W.stateWords[c.state]}: </span>
              {c.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="t-small text-soft">A tribe needs at least {minTribe} people before a placement run will fill it.</p>

      {group.members.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Members of this draft">
          {group.members.map((m) => (
            <li key={m.personId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2" data-testid="desk-group-member">
              <div className="flex flex-col gap-0.5">
                <p className="font-medium">
                  {m.name} <span className="t-small text-soft">scores {m.degree}</span>
                </p>
                {interest.members[m.personId] && interest.members[m.personId] !== "none" ? (
                  <p className="t-small text-soft" data-testid="desk-member-interest">
                    {INTEREST_WORDS[interest.members[m.personId]]}
                  </p>
                ) : null}
                {m.blocked.map((b) => (
                  <p key={b.code} className="t-small text-danger">
                    {b.text}
                  </p>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <DeskReveal person={m.personId} masked={m.phone} hasNumber={m.hasNumber} />
                <Button type="button" size="sm" variant="quiet" loading={d.busy === `rm-${m.personId}`} onClick={() => void d.go(`rm-${m.personId}`, () => removeMemberAction(group.id, m.personId))}>
                  Take out
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {interest.left.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="desk-interest-left">
          <p className="t-small font-medium">Left the draft by answering</p>
          <ul className="flex flex-col gap-1">
            {interest.left.map((l) => (
              <li key={l.personId} className="t-small text-soft">
                {l.name}: {l.answer === "other_time" ? (l.slots.length > 0 ? `would rather ${l.slots.map(slotWord).join(", ").toLowerCase()}` : "asked for a different time") : "not for them"}. Still waiting for a tribe.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DeskCheckInterest group={group.id} rehearsal={rehearsal} members={group.members.length} />

      <DeskLeaderPanel group={group.id} state={leader} rehearsal={rehearsal} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="solid" loading={asking} onClick={() => void suggest()}>
          Who would suit it
        </Button>
        <Button type="button" size="sm" variant="quiet" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          {editing ? "Close the form" : "Change the group"}
        </Button>
        {sure ? (
          <>
            <Button type="button" size="sm" variant="solid" loading={d.busy === "archive"} onClick={() => void d.go("archive", () => archiveGroupAction(group.id), { after: () => setSure(false) })}>
              Yes, archive it
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={() => setSure(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="quiet" onClick={() => setSure(true)}>
            Archive
          </Button>
        )}
      </div>
      <Notice error={d.error ?? askError} saved={d.saved} />

      {suggested ? (
        suggested.length === 0 ? (
          <p className="t-body text-soft">No waiting member fits this group yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Waiting members who would suit this group" data-testid="desk-suggestions">
            {suggested.map((s) => (
              <li key={s.personId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium">
                    {s.name} <span className="t-small text-soft">would score {s.degree}</span>
                  </p>
                  <p className="t-small text-soft">{W.waitingDays(s.days)}</p>
                  {s.watch.map((w) => (
                    <p key={w.code} className="t-small text-soft">
                      {w.text}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <DeskReveal person={s.personId} masked={s.phone} hasNumber={s.hasNumber} />
                  <Button
                    type="button"
                    size="sm"
                    variant="solid"
                    loading={d.busy === `add-${s.personId}`}
                    onClick={() =>
                      void d.go(`add-${s.personId}`, () => addMemberAction(group.id, s.personId), { after: () => setSuggested((cur) => (cur ? cur.filter((x) => x.personId !== s.personId) : cur)) })
                    }
                  >
                    Add
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {editing ? (
        <div className="border-t border-line pt-4">
          <DeskGroupForm
            choices={choices}
            groupId={group.id}
            submitLabel="Save the changes"
            initial={{
              name: group.name,
              track: group.trackId,
              community: group.communityId ?? "",
              goal: group.goalId ?? "",
              slot: group.slot,
              mode: group.mode === "in_person" ? "in_person" : "online",
              zone: group.zone ?? "",
              type: group.type === "women" || group.type === "men" ? group.type : "mixed",
              capacity: group.capacity,
              note: group.note ?? "",
            }}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
