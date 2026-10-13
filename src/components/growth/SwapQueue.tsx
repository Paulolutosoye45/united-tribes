"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { declineSwapAction, findSwapMembersAction, offerSwapAction, startSwapForAction } from "@/app/(app)/growth/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { clockLabel, dayName } from "@/lib/academy/options";
import { formatShortDate, plural } from "@/lib/dates";
import { SWAP_REASONS, type SwapItem, type SwapQueue as Queue, type SwapReason } from "@/lib/growth/types";
import { SWAP_REASON_LABELS, SWAP_STATUS } from "@/lib/growth/wording";
import { labelFor, LABELS } from "@/lib/matching/wording";

type Member = { person_id: string; name: string; tribe: string };

export function SwapQueue({ queue, initialMembers, office }: { queue: Queue; initialMembers: Member[]; office: boolean }) {
  const open = queue.items.filter((i) => i.status === "requested" || i.status === "offered");
  const closed = queue.items.filter((i) => i.status !== "requested" && i.status !== "offered");

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="open-heading" className="flex flex-col gap-3">
        <h2 id="open-heading" className="t-heading">
          Waiting for you
        </h2>
        {open.length === 0 ? (
          <p className="t-body text-soft">Nobody is waiting for a different tribe.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((item) => (
              <li key={item.id}>
                <OpenRequest item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <StartForm initialMembers={initialMembers} office={office} />

      {closed.length > 0 ? (
        <section aria-labelledby="closed-heading" className="flex flex-col gap-3">
          <h2 id="closed-heading" className="t-heading">
            Decided in the last two weeks
          </h2>
          <ul className="card flex flex-col divide-y divide-line p-0">
            {closed.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{item.person.name}</span>
                  <span className="t-small text-soft">
                    From {item.from.name}
                    {item.moved_to ? ` to ${item.moved_to}` : ""} · {item.decided_at ? formatShortDate(item.decided_at) : formatShortDate(item.created_at)}
                  </span>
                </span>
                <Badge tone={SWAP_STATUS[item.status].tone}>{SWAP_STATUS[item.status].label}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OpenRequest({ item }: { item: SwapItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  async function offer(tribe: string) {
    if (busy) return;
    setBusy(tribe);
    setError(null);
    const result = await offerSwapAction(item.id, tribe);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  async function decline() {
    if (busy) return;
    setBusy("decline");
    setError(null);
    const result = await declineSwapAction(item.id, note);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <article className="card flex flex-col gap-4 p-5" aria-label={`${item.person.name}, from ${item.from.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{item.person.name}</h3>
          <p className="t-small text-soft">
            In {item.from.name}, led by {item.from.leader}
            {item.from.community ? ` · ${item.from.community}` : ""} · asked {formatShortDate(item.created_at)}
            {item.by_coach ? " · started by a coach" : ""}
          </p>
        </div>
        <Badge tone={SWAP_STATUS[item.status].tone}>{SWAP_STATUS[item.status].label}</Badge>
      </div>

      <div className="rounded-[var(--radius-control)] bg-surface px-4 py-3">
        <p className="font-medium">{SWAP_REASON_LABELS[item.reason].label}</p>
        {item.note ? <p className="t-body mt-1 text-soft">{item.note}</p> : null}
        {item.wants ? <p className="t-small mt-1 text-soft">Would like to try {item.wants.name}.</p> : null}
      </div>

      {item.status === "offered" && item.offered ? (
        <p className="t-body">
          Offered <span className="font-semibold">{item.offered.name}</span> ({item.offered.degree}% compatible). Waiting for {item.person.first_name} to answer.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="t-small font-semibold text-soft">{item.status === "offered" ? "Or offer a different tribe" : "Tribes that still fit"}</h4>
        {item.options.length === 0 ? (
          <p className="t-body text-soft">No tribe fits {item.person.first_name} right now: they may be full, or not suit their time, format or age group.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {item.options.map((o) => (
              <li key={o.tribe_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{o.name}</span>
                  <span className="t-small text-soft">
                    {o.degree}% · {LABELS[labelFor(o.degree)].text} · {o.leader_first_name} · {dayName(o.meeting_day)}s {clockLabel(o.meeting_time)} ·{" "}
                    {o.mode === "online" ? "Online" : "In person"} · {plural(o.seats, "seat")} left{o.community ? ` · ${o.community}` : ""}
                  </span>
                </span>
                <Button size="sm" variant={item.offered?.id === o.tribe_id ? "quiet" : "solid"} loading={busy === o.tribe_id} disabled={busy !== null || item.offered?.id === o.tribe_id} onClick={() => void offer(o.tribe_id)}>
                  {item.offered?.id === o.tribe_id ? "Offered" : "Offer this tribe"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}

      {declining ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Textarea label="A word for them" optional rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint={`${item.person.first_name} will read this.`} />
          <div className="flex flex-wrap gap-3">
            <Button size="sm" loading={busy === "decline"} disabled={busy !== null && busy !== "decline"} onClick={() => void decline()}>
              Close this request
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setDeclining(false)} disabled={busy !== null}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-line pt-3">
          <Button size="sm" variant="ghost" onClick={() => setDeclining(true)} disabled={busy !== null}>
            Not this time
          </Button>
        </div>
      )}
    </article>
  );
}

function StartForm({ initialMembers, office }: { initialMembers: Member[]; office: boolean }) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState(initialMembers[0]?.person_id ?? "");
  const [reason, setReason] = useState<SwapReason>("time");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"find" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function find() {
    if (busy) return;
    setBusy("find");
    setError(null);
    const result = await findSwapMembersAction(search);
    setBusy(null);
    setSearched(true);
    if (!result.ok) return setError(result.message);
    setMembers(result.members);
    setPerson(result.members[0]?.person_id ?? "");
  }

  async function start() {
    if (busy || !person) return;
    setBusy("start");
    setError(null);
    const result = await startSwapForAction(person, reason, note);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setNote("");
    setMembers((m) => m.filter((x) => x.person_id !== person));
    setPerson("");
    router.refresh();
  }

  return (
    <section aria-labelledby="start-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="start-heading" className="t-heading">
          Start a change for a member
        </h2>
        <p className="t-small text-soft">For after the first weeks, or when a member cannot ask for themselves. They are asked before they are moved.</p>
      </div>

      {office ? (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <div className="flex-1">
            <Input label="Find a member by name" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="At least two letters" />
          </div>
          <Button type="submit" size="md" variant="quiet" loading={busy === "find"} disabled={search.trim().length < 2}>
            Find
          </Button>
        </form>
      ) : null}

      {members.length === 0 ? (
        <p className="t-body text-soft">
          {office
            ? searched
              ? "Nobody matches, or they are not in a tribe that is running, or they already have a request open."
              : "Look a member up by name to start."
            : "None of your members can have a change started just now."}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <Select label="Member" value={person} onChange={(e) => setPerson(e.target.value)}>
            {members.map((m) => (
              <option key={m.person_id} value={m.person_id}>
                {m.name} · {m.tribe}
              </option>
            ))}
          </Select>
          <Select label="Main reason" value={reason} onChange={(e) => setReason(e.target.value as SwapReason)}>
            {SWAP_REASONS.map((r) => (
              <option key={r} value={r}>
                {SWAP_REASON_LABELS[r].label}
              </option>
            ))}
          </Select>
          <Textarea label="Note" optional rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint="Kept with the request. Seen by coaches and the Care Lead." />
          <div>
            <Button type="submit" size="md" loading={busy === "start"} disabled={!person}>
              Start the change
            </Button>
          </div>
        </form>
      )}

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
