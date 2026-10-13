"use client";

import { useState } from "react";
import { assignChampionAction, findPeopleAction, removeChampionAction } from "@/app/(app)/admin/champions/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatShortDate, plural } from "@/lib/dates";
import { ROLE_LABELS, isRole } from "@/lib/auth/roles";
import type { Champion, PersonHit } from "@/lib/admin/types";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

type Community = { id: string; name: string };

export function ChampionBoard({ communities, champions, canEdit }: { communities: Community[]; champions: Champion[]; canEdit: boolean }) {
  return (
    <ul className="flex flex-col gap-5">
      {communities.map((t) => (
        <li key={t.id}>
          <CommunityChampions community={t} champions={champions.filter((c) => c.community_id === t.id)} canEdit={canEdit} />
        </li>
      ))}
    </ul>
  );
}

function CommunityChampions({ community, champions, canEdit }: { community: Community; champions: Champion[]; canEdit: boolean }) {
  const d = useDo();
  return (
    <article className="card flex flex-col gap-4 p-5 sm:p-6" aria-label={community.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-heading">{community.name}</h2>
        <span className="t-small text-soft">{champions.length === 0 ? "No champion yet" : plural(champions.length, "champion")}</span>
      </div>
      {champions.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {champions.map((c) => (
            <li key={c.person_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="flex flex-col">
                <span className="font-medium">{c.name}</span>
                <span className="t-small text-soft">Since {formatShortDate(c.since)}</span>
              </span>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="quiet"
                  loading={d.busy === c.person_id}
                  disabled={d.busy !== null}
                  onClick={() => {
                    if (window.confirm(`Take ${c.name} off as a champion of ${community.name}?`)) void d.go(c.person_id, () => removeChampionAction(c.person_id, community.id));
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Notice error={d.error} />
      {canEdit ? <Appoint community={community} already={new Set(champions.map((c) => c.person_id))} /> : null}
    </article>
  );
}

function Appoint({ community, already }: { community: Community; already: Set<string> }) {
  const d = useDo();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function search() {
    if (query.trim().length < 2 || searching) return;
    setSearching(true);
    setProblem(null);
    const result = await findPeopleAction(query);
    setSearching(false);
    if (!result.ok) {
      setHits(null);
      return setProblem(result.message);
    }
    setHits(result.people);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface p-4">
      <form
        noValidate
        role="search"
        aria-label={`Find someone to appoint for ${community.name}`}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="flex-1">
          <Input label="Appoint a champion" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} placeholder="Part of their name or email" autoComplete="off" />
        </div>
        <Button type="submit" size="md" variant="quiet" loading={searching} disabled={query.trim().length < 2}>
          Find
        </Button>
      </form>
      <Notice error={problem ?? d.error} />
      {hits !== null && hits.length === 0 ? <p className="t-small text-soft">Nobody matches that. Try part of their name or email.</p> : null}
      {hits && hits.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line bg-raised">
          {hits.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="t-small truncate text-soft">
                  {p.email}
                  {p.roles.length > 0 ? ` · ${p.roles.filter((r) => r !== "member").map((r) => (isRole(r) ? ROLE_LABELS[r] : r)).join(", ") || "Member"}` : ""}
                </span>
              </span>
              {already.has(p.id) ? (
                <span className="t-small text-soft">Already a champion</span>
              ) : (
                <Button
                  size="sm"
                  loading={d.busy === p.id}
                  disabled={d.busy !== null}
                  onClick={() => void d.go(p.id, () => assignChampionAction(p.id, community.id), { after: () => {
                    setHits(null);
                    setQuery("");
                  } })}
                >
                  Appoint
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
