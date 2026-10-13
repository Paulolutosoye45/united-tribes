"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearPlanAction, planAction } from "@/app/(app)/growth/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Select, Textarea } from "@/components/ui/Input";
import { formatShortDate, plural } from "@/lib/dates";
import { PLANS, type BoardTribe, type MultiplicationBoard, type Plan } from "@/lib/growth/types";
import { ASSISTANT_STATE, KIND_LABELS, PLAN_LABELS } from "@/lib/growth/wording";

type Ok = Extract<MultiplicationBoard, { state: "ok" }>;

export function MultiplyBoard({ board }: { board: Ok }) {
  const { summary } = board;
  const decided = board.tribes.filter((c) => c.plan).length;

  return (
    <div className="flex flex-col gap-8">
      <section aria-label={`Season ${board.season.name}`} className="flex flex-col gap-3">
        <p className="t-small text-soft">
          {board.season.name}, ending {formatShortDate(board.season.ends_on)}
        </p>
        <dl className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Tribes", value: summary.tribes },
            { label: "With an assistant", value: summary.with_assistant },
            { label: "Assistant certified", value: summary.certified },
            { label: "New tribes planned", value: summary.new_planned },
          ].map((tile, i) => (
            <div key={tile.label} className="card p-4" style={{ ["--i" as string]: i }}>
              <dt className="t-small text-soft">{tile.label}</dt>
              <dd className="t-title mt-1 tabular-nums">{tile.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {board.gaps.length > 0 ? (
        <section aria-labelledby="gaps-heading" className="card flex flex-col gap-3 p-5 sm:p-7">
          <div className="flex flex-col gap-1">
            <h2 id="gaps-heading" className="t-heading">
              Where new tribes are most needed
            </h2>
            <p className="t-small text-soft">Members the matching could not place well, grouped by what they asked for.</p>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {board.gaps.map((g, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-medium">
                  {[g.community, g.track].filter(Boolean).join(" · ") || "Any community"}
                  <span className="t-small ml-2 font-normal text-soft">{KIND_LABELS[g.kind] ?? g.kind}</span>
                </span>
                <Badge tone="gold">{plural(g.members, "member")} waiting</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="tribes-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tribes-heading" className="t-heading">
            Tribes
          </h2>
          <p className="t-small text-soft">
            {decided} of {board.tribes.length} decided
          </p>
        </div>
        {board.tribes.length === 0 ? (
          <p className="t-body text-soft">There are no tribes in this season.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {board.tribes.map((c) => (
              <li key={c.id}>
                <TribeCard tribe={c} communities={board.communities} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TribeCard({ tribe, communities }: { tribe: BoardTribe; communities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(tribe.plan);
  const [community, setCommunity] = useState(tribe.plan_community_id ?? communities[0]?.id ?? "");
  const [note, setNote] = useState(tribe.note ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = ASSISTANT_STATE[tribe.assistant_state];
  const changed = plan !== tribe.plan || (plan === "assistant_leads" && community !== tribe.plan_community_id) || note.trim() !== (tribe.note ?? "");

  async function save() {
    if (busy || !plan) return;
    setBusy("save");
    setError(null);
    const result = await planAction(tribe.id, plan, plan === "assistant_leads" ? community : null, note);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  async function clear() {
    if (busy) return;
    setBusy("clear");
    setError(null);
    const result = await clearPlanAction(tribe.id);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setPlan(null);
    setNote("");
    router.refresh();
  }

  return (
    <article className="card flex flex-col gap-4 p-5" aria-label={tribe.name}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{tribe.name}</h3>
          <p className="t-small text-soft">
            Led by {tribe.leader}
            {tribe.assistant ? `, with ${tribe.assistant}` : ""} · {plural(tribe.members, "member")}
            {tribe.community ? ` · ${tribe.community}` : ""}
          </p>
        </div>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>

      <div role="group" aria-label={`What happens to ${tribe.name} next`} className="flex flex-wrap gap-2">
        {PLANS.map((p) => {
          const blocked = p === "assistant_leads" && tribe.assistant_state !== "certified";
          return (
            <Chip key={p} selected={plan === p} disabled={blocked || busy !== null} onClick={() => setPlan(p)} title={blocked ? "Needs an assistant who has finished their training" : PLAN_LABELS[p].blurb}>
              {PLAN_LABELS[p].label}
            </Chip>
          );
        })}
      </div>
      {plan ? <p className="t-small text-soft">{PLAN_LABELS[plan].blurb}</p> : <p className="t-small text-soft">Not decided yet.</p>}

      {plan === "assistant_leads" ? (
        <Select label="The new tribe's community" value={community} onChange={(e) => setCommunity(e.target.value)} disabled={busy !== null}>
          {communities.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ) : null}

      {plan ? <Textarea label="Note" optional rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy !== null} /> : null}

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {plan ? (
          <Button size="sm" loading={busy === "save"} disabled={!changed || (busy !== null && busy !== "save")} onClick={() => void save()}>
            Save the plan
          </Button>
        ) : null}
        {tribe.plan ? (
          <Button size="sm" variant="ghost" loading={busy === "clear"} disabled={busy === "save"} onClick={() => void clear()}>
            Take the plan back
          </Button>
        ) : null}
        {tribe.plan && tribe.decided_by && !changed ? (
          <span className="t-small text-soft">
            Decided by {tribe.decided_by}
            {tribe.decided_at ? `, ${formatShortDate(tribe.decided_at)}` : ""}
          </span>
        ) : null}
      </div>
    </article>
  );
}
